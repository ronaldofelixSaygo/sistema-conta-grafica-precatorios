import { prisma } from '../config/prisma.js';
import { clienteScope } from '../utils/scope.js';
import { STAGES_ORDER, MAX_UPLOAD_BYTES, nextStage } from '../utils/kanban.constants.js';
import { getEffectiveConfig } from './stageConfig.service.js';

// Cria todas as etapas do card a partir da configuracao editavel.
// stageParceiros: { ONBOARDING: 'parceiroId', CONTRATACAO_SALA: 'parceiroId', ... }
async function ensureStages(cardId, stageParceiros = {}) {
  for (let i = 0; i < STAGES_ORDER.length; i++) {
    const stage = STAGES_ORDER[i];
    const cfg = await getEffectiveConfig(stage);
    const exists = await prisma.kanbanStageProgress.findUnique({
      where: { cardId_stage: { cardId, stage } },
    });
    if (exists) continue;
    await prisma.kanbanStageProgress.create({
      data: {
        cardId, stage,
        status: i === 0 ? 'IN_PROGRESS' : 'PENDING',
        startedAt: i === 0 ? new Date() : null,
        slaHours: cfg.slaHours,
        responsibleRole: cfg.defaultResponsibleRole || null,
        parceiroId: stageParceiros[stage] || null,
        checklist: (cfg.checklist || []).map(label =>
          (typeof label === 'string' ? { label, done: false } : label)
        ),
      },
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

  const card = await prisma.kanbanCard.create({
    data: { clienteId: cli.id, notes: notes || null },
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
      label: String(it.label || ''),
      done:  !!it.done,
    }));
  }
  if (Object.keys(data).length === 0) {
    const e = new Error('Nada a atualizar (sem permissao ou payload vazio)'); e.status = 400; throw e;
  }

  const updated = await prisma.kanbanStageProgress.update({ where: { id: sp.id }, data });
  return updated;
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

  const nx = nextStage(stage);
  if (nx) {
    await prisma.kanbanStageProgress.updateMany({
      where: { cardId, stage: nx },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
    await prisma.kanbanCard.update({
      where: { id: cardId },
      data: { currentStage: nx, ...(nx === 'CONCLUIDO' ? { completedAt: new Date() } : {}) },
    });
  }
  return { ok: true, nextStage: nx };
}

export async function moveCard(user, cardId, toStage) {
  if (!(user.role === 'ADM' || user.role === 'SAYGO')) {
    const e = new Error('Apenas Saygo pode mover manualmente'); e.status = 403; throw e;
  }
  if (!STAGES_ORDER.includes(toStage)) {
    const e = new Error('Etapa invalida'); e.status = 400; throw e;
  }
  const card = await prisma.kanbanCard.findUnique({ where: { id: cardId } });
  if (!card) { const e = new Error('Card nao encontrado'); e.status = 404; throw e; }

  for (const stage of STAGES_ORDER) {
    const idx  = STAGES_ORDER.indexOf(stage);
    const tIdx = STAGES_ORDER.indexOf(toStage);
    let data = {};
    if (idx <  tIdx) data = { status: 'COMPLETED',  completedAt: new Date(), startedAt: new Date() };
    if (idx === tIdx) data = { status: 'IN_PROGRESS', startedAt: new Date(), completedAt: null };
    if (idx >  tIdx) data = { status: 'PENDING',     startedAt: null,        completedAt: null };
    await prisma.kanbanStageProgress.updateMany({ where: { cardId, stage }, data });
  }

  await prisma.kanbanCard.update({
    where: { id: cardId },
    data: {
      currentStage: toStage,
      completedAt:  toStage === 'CONCLUIDO' ? new Date() : null,
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

export const KANBAN = { STAGES_ORDER };
