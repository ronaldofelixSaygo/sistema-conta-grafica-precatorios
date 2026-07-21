import { prisma } from '../config/prisma.js';
import { clienteScope } from '../utils/scope.js';
import { MAX_UPLOAD_BYTES } from '../utils/kanban.constants.js';
import * as stageDef from './stageDef.service.js';
import * as email from './email.service.js';
import * as storage from './storage.service.js';
import { computeBusinessDeadline, getSlaContext } from './sla.service.js';

// Decora uma stageProgress com o prazo previsto (em horário comercial/dias
// úteis) e as horas realizadas (tempo corrido, informativo).
function decorateStage(s, ctx) {
  return {
    ...s,
    slaDeadline: s.startedAt ? computeBusinessDeadline(new Date(s.startedAt), s.slaHours, ctx) : null,
    realizedHours: s.startedAt && s.completedAt
      ? Math.round((new Date(s.completedAt) - new Date(s.startedAt)) / 36e5 * 10) / 10
      : null,
  };
}

// Atualiza campos de status do Cliente quando uma etapa é concluída.
// O mapeamento é por LABEL da etapa (case-insensitive) pra ser robusto a mudanças de key.
async function autoUpdateClienteFromStage(cardId, stageKey) {
  const card = await prisma.kanbanCard.findUnique({
    where: { id: cardId }, select: { clienteId: true },
  });
  if (!card?.clienteId) return;
  const def = await prisma.kanbanStageDef.findUnique({ where: { key: stageKey } });
  const label = (def?.label || stageKey || '').toLowerCase();

  const upd = {};
  if (/sala/.test(label))                        upd.locacaoSala     = 'Sim';
  if (/filial|matriz|empresa/.test(label))       upd.aberturaFilial  = 'Sim';
  if (/\bie\b|inscri/.test(label))               upd.reativacaoIe    = 'Sim';
  if (/conta\s*gr[áa]fica/.test(label))          upd.contaGrafica    = 'Sim';

  if (Object.keys(upd).length === 0) return;
  await prisma.cliente.update({ where: { id: card.clienteId }, data: upd });
}

// Cria todas as etapas do card lendo da configuracao dinamica.
// stageParceiros: { 'ONBOARDING': 'parceiroId', ... }
async function ensureStages(cardId, stageParceiros = {}) {
  const stages = await stageDef.getStagesOrdered();
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const exists = await prisma.kanbanStageProgress.findUnique({
      where: { cardId_stage: { cardId, stage: s.key } },
    });
    if (exists) continue;
    const checklist = (s.activities || []).map(a => ({
      id: a.id, label: a.label, done: false, doneAt: null,
    }));
    await prisma.kanbanStageProgress.create({
      data: {
        cardId, stage: s.key,
        status: i === 0 ? 'IN_PROGRESS' : 'PENDING',
        startedAt: i === 0 ? new Date() : null,
        slaHours: s.slaHours,
        responsibleRole: s.defaultResponsibleRole || null,
        parceiroId: stageParceiros[s.key] || null,
        checklist,
      },
    });
  }
  // Garante que o currentStage corresponde a uma etapa ativa.
  if (stages.length > 0) {
    await prisma.kanbanCard.update({
      where: { id: cardId },
      data: { currentStage: stages[0].key },
    });
  }
}

// Verdadeiro se o user é responsável pela stage, seja diretamente como
// User (responsibleUserId), seja indiretamente como Parceiro (parceiroId).
// Necessário pros kinds operacionais de etapa (ARMADOR_LOGISTICO, etc) que
// são atribuídos via parceiroId, sem User específico.
function isStageResponsible(user, sp) {
  if (!user || !sp) return false;
  if (sp.responsibleUserId && sp.responsibleUserId === user.id) return true;
  if (user.role === 'PARTNER' && user.parceiroId && sp.parceiroId === user.parceiroId) return true;
  return false;
}

// Scope dos cards do Kanban.
// Regras:
//  ADM/SAYGO        → vê todos.
//  CLIENT           → vê só os cards do próprio cliente.
//  PARTNER          → vê (a) cards dos clientes vinculados a ele (escritório,
//                     contabilidade, despachante) OR (b) cards onde ele é
//                     parceiro responsável por alguma stage (caso típico do
//                     ARMADOR_LOGISTICO e outros kinds operacionais de etapa).
function cardScopeWhere(user) {
  if (!user) return { id: -1 };
  if (user.role === 'PARTNER' && user.parceiroId) {
    return {
      OR: [
        { cliente: clienteScope(user) },
        { stages: { some: { parceiroId: user.parceiroId } } },
      ],
    };
  }
  return { cliente: clienteScope(user) };
}

export async function listCards(user) {
  const cards = await prisma.kanbanCard.findMany({
    where: cardScopeWhere(user),
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true } },
      stages: {
        // Ordenacao real e feita no frontend pelo order da KanbanStageDef
        orderBy: { createdAt: 'asc' },
        include: {
          responsibleUser: { select: { id: true, name: true, role: true } },
          parceiro:        { select: { id: true, nome: true, isSaygo: true } },
        },
      },
      _count: { select: { attachments: true } },
    },
    orderBy: { startedAt: 'desc' },
  });
  const ctx = await getSlaContext();
  return cards.map(c => ({
    id: c.id,
    clienteId: c.clienteId,
    clienteNome: c.cliente.nome,
    clienteEscritorio: c.cliente.escritorio,
    currentStage: c.currentStage,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
    notes: c.notes,
    attachments: c._count.attachments,
    stages: c.stages.map(s => decorateStage(s, ctx)),
  }));
}

export async function createCard(user, { clienteId, notes, stageParceiros }) {
  if (!(user.role === 'ADM' || user.role === 'SAYGO')) {
    const e = new Error('Apenas Saygo pode criar cards no Kanban'); e.status = 403; throw e;
  }
  const cli = await prisma.cliente.findUnique({ where: { id: Number(clienteId) } });
  if (!cli) { const e = new Error('Cliente nao encontrado'); e.status = 404; throw e; }
  const exists = await prisma.kanbanCard.findUnique({ where: { clienteId: cli.id } });
  if (exists) { const e = new Error('Cliente ja tem um card no Kanban'); e.status = 409; throw e; }

  const stages = await stageDef.getStagesOrdered();
  if (!stages.length) {
    const e = new Error('Nenhuma etapa cadastrada. Cadastre etapas em Parametros antes de criar cards.');
    e.status = 400; throw e;
  }

  const card = await prisma.kanbanCard.create({
    data: { clienteId: cli.id, currentStage: stages[0].key, notes: notes || null },
  });
  await ensureStages(card.id, stageParceiros || {});
  return card;
}

export async function getCard(user, cardId) {
  const card = await prisma.kanbanCard.findFirst({
    where: { id: cardId, ...cardScopeWhere(user) },
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true } },
      stages: {
        // Ordenacao real e feita no frontend pelo order da KanbanStageDef
        orderBy: { createdAt: 'asc' },
        include: {
          responsibleUser: { select: { id: true, name: true, role: true } },
          parceiro:        { select: { id: true, nome: true, isSaygo: true, telefone: true, email: true } },
          attachments: {
            select: { id: true, filename: true, mimeType: true, size: true, createdAt: true,
                      uploadedBy: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      },
      attachments: {
        where: { stageProgressId: null },
        select: { id: true, filename: true, mimeType: true, size: true, createdAt: true,
                  uploadedBy: { select: { id: true, name: true } } },
      },
    },
  });
  if (!card) { const e = new Error('Card nao encontrado'); e.status = 404; throw e; }
  const ctx = await getSlaContext();
  return { ...card, stages: card.stages.map(s => decorateStage(s, ctx)) };
}

export async function updateStage(user, cardId, stage, payload) {
  const sp = await prisma.kanbanStageProgress.findFirst({
    where: { cardId, stage, card: cardScopeWhere(user) },
    include: { card: true },
  });
  if (!sp) { const e = new Error('Etapa nao encontrada'); e.status = 404; throw e; }

  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  const isResponsible = isStageResponsible(user, sp);
  const data = {};

  if (isStaff) {
    if (payload.slaHours          !== undefined) data.slaHours         = Number(payload.slaHours) || 0;
    if (payload.responsibleUserId !== undefined) data.responsibleUserId = payload.responsibleUserId || null;
    if (payload.responsibleRole   !== undefined) data.responsibleRole   = payload.responsibleRole   || null;
    if (payload.parceiroId        !== undefined) data.parceiroId        = payload.parceiroId || null;
    if (payload.notes             !== undefined) data.notes             = payload.notes || null;
    if (payload.status            !== undefined) data.status            = payload.status;
  }
  if (payload.checklist !== undefined && (isStaff || isResponsible)) {
    if (!Array.isArray(payload.checklist)) {
      const e = new Error('checklist deve ser um array'); e.status = 400; throw e;
    }
    // Carimba doneAt no servidor (fonte de verdade): quando um item passa a
    // concluído, registra o instante; se já estava concluído, preserva o
    // timestamp original; se desmarcado, limpa. Casa o item anterior por id
    // (fallback: índice) pra não perder o doneAt já gravado.
    const prev = Array.isArray(sp.checklist) ? sp.checklist : [];
    const nowIso = new Date().toISOString();
    data.checklist = payload.checklist.map((it, idx) => {
      const done = !!it.done;
      const prevItem = (it.id != null && prev.find(p => p && p.id === it.id)) || prev[idx] || {};
      let doneAt = null;
      if (done) {
        doneAt = (prevItem.done && prevItem.doneAt) ? prevItem.doneAt : (it.doneAt || nowIso);
      }
      return {
        id: it.id || null,
        label: String(it.label || ''),
        done,
        doneAt,
      };
    });
  }
  if (Object.keys(data).length === 0) {
    const e = new Error('Nada a atualizar (sem permissao ou payload vazio)'); e.status = 400; throw e;
  }

  return prisma.kanbanStageProgress.update({ where: { id: sp.id }, data });
}

export async function completeStage(user, cardId, stage, { force = false } = {}) {
  const sp = await prisma.kanbanStageProgress.findFirst({
    where: { cardId, stage, card: cardScopeWhere(user) },
  });
  if (!sp) { const e = new Error('Etapa nao encontrada'); e.status = 404; throw e; }

  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  const isResponsible = isStageResponsible(user, sp);
  if (!isStaff && !isResponsible) {
    const e = new Error('Sem permissao para concluir esta etapa'); e.status = 403; throw e;
  }

  const checklist = Array.isArray(sp.checklist) ? sp.checklist : [];
  const pending = checklist.filter(it => !it.done);
  if (pending.length > 0 && !force) {
    const e = new Error(`Checklist tem ${pending.length} item(s) pendente(s)`);
    e.status = 400; e.code = 'PENDING_CHECKLIST'; e.pending = pending.length; throw e;
  }

  // PERF: tudo em UMA transação só — antes eram 4 idas separadas ao banco
  // em série. Em Neon (latência ~50ms), isso virava 200-300ms desnecessários
  // por clique em "Concluir etapa".
  const nx = await stageDef.nextActiveStageKey(stage);
  const nxDef = nx ? await prisma.kanbanStageDef.findUnique({ where: { key: nx } }) : null;
  await prisma.$transaction(async (tx) => {
    await tx.kanbanStageProgress.update({
      where: { id: sp.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (nx) {
      await tx.kanbanStageProgress.updateMany({
        where: { cardId, stage: nx },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      await tx.kanbanCard.update({
        where: { id: cardId },
        data: { currentStage: nx, ...(nxDef?.isFinal ? { completedAt: new Date() } : {}) },
      });
    }
  });

  // Pós-transação (fire-and-forget): auto-update do cliente + e-mails.
  // Não bloqueia o response — usuário não espera por isso.
  setImmediate(() => {
    autoUpdateClienteFromStage(cardId, stage).catch(err => console.warn('autoUpdateCliente falhou:', err.message));
    email.notifyStageDone({ cardId, stageKey: stage, byUser: user })
      .catch(err => console.error('[kanban] notifyStageDone falhou:', err));
    if (nx) email.notifyStageChange({ cardId, fromStage: stage, toStage: nx, byUser: user })
        .catch(err => console.error('[kanban] notifyStageChange falhou:', err));
  });
  return { ok: true, nextStage: nx };
}

export async function moveCard(user, cardId, toStage) {
  if (!(user.role === 'ADM' || user.role === 'SAYGO')) {
    const e = new Error('Apenas Saygo pode mover manualmente'); e.status = 403; throw e;
  }
  const stages = await stageDef.getStagesOrdered();
  const keys = stages.map(s => s.key);
  if (!keys.includes(toStage)) {
    const e = new Error('Etapa invalida'); e.status = 400; throw e;
  }
  const card = await prisma.kanbanCard.findUnique({ where: { id: cardId } });
  if (!card) { const e = new Error('Card nao encontrado'); e.status = 404; throw e; }
  const tIdx = keys.indexOf(toStage);

  const toDef = stages[tIdx];
  const fromStage = card.currentStage;
  const now = new Date();
  // PERF: antes era um for loop com N updateMany sequenciais (1 query por etapa,
  // ~6-8 roundtrips no Neon = 300-400ms). Agora: 3 updateMany via $in + 1 update
  // do card, tudo em UMA transação = ~50-80ms total.
  const passed  = keys.slice(0, tIdx);
  const current = keys[tIdx];
  const future  = keys.slice(tIdx + 1);
  await prisma.$transaction(async (tx) => {
    if (passed.length) {
      await tx.kanbanStageProgress.updateMany({
        where: { cardId, stage: { in: passed } },
        data: { status: 'COMPLETED', completedAt: now, startedAt: now },
      });
    }
    await tx.kanbanStageProgress.updateMany({
      where: { cardId, stage: current },
      data: { status: 'IN_PROGRESS', startedAt: now, completedAt: null },
    });
    if (future.length) {
      await tx.kanbanStageProgress.updateMany({
        where: { cardId, stage: { in: future } },
        data: { status: 'PENDING', startedAt: null, completedAt: null },
      });
    }
    await tx.kanbanCard.update({
      where: { id: cardId },
      data: { currentStage: toStage, completedAt: toDef?.isFinal ? now : null },
    });
  });
  // E-mail pós-transação (fire-and-forget)
  if (fromStage !== toStage) {
    setImmediate(() => {
      email.notifyStageChange({ cardId, fromStage, toStage, byUser: user })
        .catch(err => console.error('[kanban] notifyStageChange (moveCard) falhou:', err));
    });
  }
  return { ok: true };
}

export async function uploadAttachment(user, cardId, file, { stageProgressId = null } = {}) {
  if (!file) { const e = new Error('Arquivo nao enviado'); e.status = 400; throw e; }
  if (file.size > MAX_UPLOAD_BYTES) {
    const e = new Error(`Arquivo muito grande (max ${MAX_UPLOAD_BYTES / (1024*1024)}MB)`); e.status = 400; throw e;
  }
  const card = await prisma.kanbanCard.findFirst({
    where: { id: cardId, ...cardScopeWhere(user) },
  });
  if (!card) { const e = new Error('Card nao encontrado'); e.status = 404; throw e; }

  // S3 quando habilitado; senão fallback pra bytes inline.
  let s3Key = null;
  let content = null;
  if (storage.isEnabled()) {
    const key = storage.buildKey('kanban', [cardId], file.originalname);
    await storage.uploadBuffer({
      key, buffer: file.buffer, contentType: file.mimetype,
      contentDisposition: `inline; filename="${encodeURIComponent(file.originalname)}"`,
    });
    s3Key = key;
  } else {
    content = file.buffer;
  }
  return prisma.kanbanAttachment.create({
    data: {
      cardId,
      stageProgressId: stageProgressId || null,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      content,
      s3Key,
      uploadedById: user.id,
    },
    select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
  });
}

export async function downloadAttachment(user, attachmentId, opts = {}) {
  const att = await prisma.kanbanAttachment.findFirst({
    where: { id: attachmentId, card: cardScopeWhere(user) },
  });
  if (!att) { const e = new Error('Anexo nao encontrado'); e.status = 404; throw e; }
  // opts.download: força disposition=attachment (forçar download em vez de
  // preview inline). Mesmo endpoint serve preview e download por query.
  const inline = !opts.download;
  if (att.s3Key) {
    const url = await storage.getDownloadUrl(att.s3Key, { filename: att.filename, inline });
    return { redirectUrl: url };
  }
  return { ...att, _inline: inline };
}

export async function deleteAttachment(user, attachmentId) {
  const att = await prisma.kanbanAttachment.findFirst({
    where: { id: attachmentId, card: cardScopeWhere(user) },
  });
  if (!att) { const e = new Error('Anexo nao encontrado'); e.status = 404; throw e; }
  if (!(user.role === 'ADM' || user.role === 'SAYGO' || att.uploadedById === user.id)) {
    const e = new Error('Sem permissao'); e.status = 403; throw e;
  }
  await prisma.kanbanAttachment.delete({ where: { id: attachmentId } });
  if (att.s3Key) storage.deleteObject(att.s3Key).catch(() => {});
  return { ok: true };
}
