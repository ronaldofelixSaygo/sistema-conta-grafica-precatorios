import { prisma } from '../config/prisma.js';
import { clienteScope } from '../utils/scope.js';
import { MAX_UPLOAD_BYTES } from '../utils/kanban.constants.js';
import * as stageDef from './stageDef.service.js';

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
      id: a.id, label: a.label, done: false,
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

function cardScopeWhere(user) { return { cliente: clienteScope(user) }; }

export async function listCards(user) {
  const cards = await prisma.kanbanCard.findMany({
    where: cardScopeWhere(user),
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true } },
      stages: {
        orderBy: { stage: 'asc' },
        include: {
          responsibleUser: { select: { id: true, name: true, role: true } },
          parceiro:        { select: { id: true, nome: true, isSaygo: true } },
        },
      },
      _count: { select: { attachments: true } },
    },
    orderBy: { startedAt: 'desc' },
  });
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
    stages: c.stages.map(s => ({
      ...s,
      slaDeadline: s.startedAt ? new Date(new Date(s.startedAt).getTime() + s.slaHours * 3600_000) : null,
      realizedHours: s.startedAt && s.completedAt
        ? Math.round((new Date(s.completedAt) - new Date(s.startedAt)) / 36e5 * 10) / 10
        : null,
    })),
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
        orderBy: { stage: 'asc' },
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
  return card;
}

export async function updateStage(user, cardId, stage, payload) {
  const sp = await prisma.kanbanStageProgress.findFirst({
    where: { cardId, stage, card: cardScopeWhere(user) },
    include: { card: true },
  });
  if (!sp) { const e = new Error('Etapa nao encontrada'); e.status = 404; throw e; }

  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  const isResponsible = sp.responsibleUserId === user.id;
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
    data.checklist = payload.checklist.map(it => ({
      id: it.id || null,
      label: String(it.label || ''),
      done:  !!it.done,
    }));
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
  const isResponsible = sp.responsibleUserId === user.id;
  if (!isStaff && !isResponsible) {
    const e = new Error('Sem permissao para concluir esta etapa'); e.status = 403; throw e;
  }

  const checklist = Array.isArray(sp.checklist) ? sp.checklist : [];
  const pending = checklist.filter(it => !it.done);
  if (pending.length > 0 && !force) {
    const e = new Error(`Checklist tem ${pending.length} item(s) pendente(s)`);
    e.status = 400; e.code = 'PENDING_CHECKLIST'; e.pending = pending.length; throw e;
  }

  await prisma.kanbanStageProgress.update({
    where: { id: sp.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  const nx = await stageDef.nextActiveStageKey(stage);
  if (nx) {
    await prisma.kanbanStageProgress.updateMany({
      where: { cardId, stage: nx },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
    // Detecta se nx e final
    const nxDef = await prisma.kanbanStageDef.findUnique({ where: { key: nx } });
    await prisma.kanbanCard.update({
      where: { id: cardId },
      data: { currentStage: nx, ...(nxDef?.isFinal ? { completedAt: new Date() } : {}) },
    });
  }
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

  for (let i = 0; i < keys.length; i++) {
    const stage = keys[i];
    let data = {};
    if (i <  tIdx) data = { status: 'COMPLETED',   completedAt: new Date(), startedAt: new Date() };
    if (i === tIdx) data = { status: 'IN_PROGRESS', startedAt: new Date(), completedAt: null };
    if (i >  tIdx) data = { status: 'PENDING',      startedAt: null,        completedAt: null };
    await prisma.kanbanStageProgress.updateMany({ where: { cardId, stage }, data });
  }
  const toDef = stages[tIdx];
  await prisma.kanbanCard.update({
    where: { id: cardId },
    data: {
      currentStage: toStage,
      completedAt:  toDef?.isFinal ? new Date() : null,
    },
  });
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

  return prisma.kanbanAttachment.create({
    data: {
      cardId,
      stageProgressId: stageProgressId || null,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      content: file.buffer,
      uploadedById: user.id,
    },
    select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
  });
}

export async function downloadAttachment(user, attachmentId) {
  const att = await prisma.kanbanAttachment.findFirst({
    where: { id: attachmentId, card: cardScopeWhere(user) },
  });
  if (!att) { const e = new Error('Anexo nao encontrado'); e.status = 404; throw e; }
  return att;
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
  return { ok: true };
}
