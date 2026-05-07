import { prisma } from '../config/prisma.js';
import { clienteScope } from '../utils/scope.js';
import {
  STAGES_ORDER, STAGE_META, MAX_UPLOAD_BYTES, nextStage,
} from '../utils/kanban.constants.js';

// =====================================================================
// Helper: Cria automaticamente todas as 5 etapas (+ CONCLUIDO) ao criar
// um KanbanCard. A 1ª etapa começa IN_PROGRESS, as demais PENDING.
// =====================================================================
async function ensureStages(cardId) {
  for (let i = 0; i < STAGES_ORDER.length; i++) {
    const stage = STAGES_ORDER[i];
    const meta = STAGE_META[stage];
    const exists = await prisma.kanbanStageProgress.findUnique({
      where: { cardId_stage: { cardId, stage } },
    });
    if (exists) continue;
    await prisma.kanbanStageProgress.create({
      data: {
        cardId, stage,
        status: i === 0 ? 'IN_PROGRESS' : 'PENDING',
        startedAt: i === 0 ? new Date() : null,
        slaHours: meta.slaHours,
        responsibleRole: meta.responsibleRole ?? null,
        checklist: meta.defaultChecklist,
      },
    });
  }
}

// Aplica scoping nas queries — Parceiros só veem cards dos clientes do escritório,
// Cliente só vê seu próprio card, Saygo/Adm vê tudo.
function cardScopeWhere(user) {
  return { cliente: clienteScope(user) };
}

// ── Listar todos os cards (board) ────────────────────────────────────
export async function listCards(user) {
  const cards = await prisma.kanbanCard.findMany({
    where: cardScopeWhere(user),
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true } },
      stages: {
        orderBy: { stage: 'asc' },
        include: {
          responsibleUser: { select: { id: true, name: true, role: true } },
        },
      },
      _count: { select: { attachments: true } },
    },
    orderBy: { startedAt: 'desc' },
  });
  // Agrupa por etapa (board) e calcula previsto/realizado
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

// ── Criar card pra um cliente (apenas ADM/SAYGO) ─────────────────────
export async function createCard(user, { clienteId, notes }) {
  if (!(user.role === 'ADM' || user.role === 'SAYGO')) {
    const e = new Error('Apenas Saygo pode criar cards no Kanban'); e.status = 403; throw e;
  }
  const cli = await prisma.cliente.findUnique({ where: { id: Number(clienteId) } });
  if (!cli) { const e = new Error('Cliente não encontrado'); e.status = 404; throw e; }
  const exists = await prisma.kanbanCard.findUnique({ where: { clienteId: cli.id } });
  if (exists) { const e = new Error('Cliente já tem um card no Kanban'); e.status = 409; throw e; }

  const card = await prisma.kanbanCard.create({
    data: { clienteId: cli.id, notes: notes || null },
  });
  await ensureStages(card.id);
  return card;
}

// ── Detalhe de um card (com etapas, anexos, etc) ─────────────────────
export async function getCard(user, cardId) {
  const card = await prisma.kanbanCard.findFirst({
    where: { id: cardId, ...cardScopeWhere(user) },
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true } },
      stages: {
        orderBy: { stage: 'asc' },
        include: {
          responsibleUser: { select: { id: true, name: true, role: true } },
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
  if (!card) { const e = new Error('Card não encontrado'); e.status = 404; throw e; }
  return card;
}

// ── Atualizar etapa (checklist, responsável, notes, sla) ─────────────
export async function updateStage(user, cardId, stage, payload) {
  // Defesa: só ADM/SAYGO mexe livremente; PARTNER pode marcar checklist se for responsável
  const sp = await prisma.kanbanStageProgress.findFirst({
    where: { cardId, stage, card: cardScopeWhere(user) },
    include: { card: true },
  });
  if (!sp) { const e = new Error('Etapa não encontrada'); e.status = 404; throw e; }

  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  const isResponsible = sp.responsibleUserId === user.id;
  const data = {};

  // Quem pode mudar o quê:
  if (isStaff) {
    if (payload.slaHours          !== undefined) data.slaHours         = Number(payload.slaHours) || 0;
    if (payload.responsibleUserId !== undefined) data.responsibleUserId = payload.responsibleUserId || null;
    if (payload.responsibleRole   !== undefined) data.responsibleRole   = payload.responsibleRole   || null;
    if (payload.notes             !== undefined) data.notes             = payload.notes || null;
    if (payload.status            !== undefined) data.status            = payload.status;
  }
  // Checklist pode ser atualizado por staff OU pelo responsável
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
    const e = new Error('Nada a atualizar (sem permissão ou payload vazio)'); e.status = 400; throw e;
  }

  const updated = await prisma.kanbanStageProgress.update({
    where: { id: sp.id }, data,
  });
  return updated;
}

// ── Concluir etapa: avança o card para a próxima (auto) ──────────────
export async function completeStage(user, cardId, stage) {
  const sp = await prisma.kanbanStageProgress.findFirst({
    where: { cardId, stage, card: cardScopeWhere(user) },
  });
  if (!sp) { const e = new Error('Etapa não encontrada'); e.status = 404; throw e; }

  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  const isResponsible = sp.responsibleUserId === user.id;
  if (!isStaff && !isResponsible) {
    const e = new Error('Sem permissão para concluir esta etapa'); e.status = 403; throw e;
  }

  // Verifica se todos os itens do checklist estão done
  const checklist = Array.isArray(sp.checklist) ? sp.checklist : [];
  const pending = checklist.filter(it => !it.done);
  if (pending.length > 0 && !isStaff) {
    const e = new Error(`Checklist tem ${pending.length} item(s) pendente(s)`); e.status = 400; throw e;
  }

  // Marca como concluída
  await prisma.kanbanStageProgress.update({
    where: { id: sp.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  // Avança o card pra próxima etapa
  const nx = nextStage(stage);
  if (nx) {
    // Inicia a próxima
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

// ── Mover card manualmente (apenas Saygo) ────────────────────────────
export async function moveCard(user, cardId, toStage) {
  if (!(user.role === 'ADM' || user.role === 'SAYGO')) {
    const e = new Error('Apenas Saygo pode mover manualmente'); e.status = 403; throw e;
  }
  if (!STAGES_ORDER.includes(toStage)) {
    const e = new Error('Etapa inválida'); e.status = 400; throw e;
  }
  const card = await prisma.kanbanCard.findUnique({ where: { id: cardId } });
  if (!card) { const e = new Error('Card não encontrado'); e.status = 404; throw e; }

  // Atualiza estados das etapas: tudo antes de toStage = COMPLETED, toStage = IN_PROGRESS, depois = PENDING
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

// ── Anexos ───────────────────────────────────────────────────────────
export async function uploadAttachment(user, cardId, file, { stageProgressId = null } = {}) {
  if (!file) { const e = new Error('Arquivo não enviado'); e.status = 400; throw e; }
  if (file.size > MAX_UPLOAD_BYTES) {
    const e = new Error(`Arquivo muito grande (max ${MAX_UPLOAD_BYTES / (1024*1024)}MB)`); e.status = 400; throw e;
  }
  // Verifica escopo
  const card = await prisma.kanbanCard.findFirst({
    where: { id: cardId, ...cardScopeWhere(user) },
  });
  if (!card) { const e = new Error('Card não encontrado'); e.status = 404; throw e; }

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
    where: {
      id: attachmentId,
      card: cardScopeWhere(user),
    },
  });
  if (!att) { const e = new Error('Anexo não encontrado'); e.status = 404; throw e; }
  return att;
}

export async function deleteAttachment(user, attachmentId) {
  const att = await prisma.kanbanAttachment.findFirst({
    where: { id: attachmentId, card: cardScopeWhere(user) },
  });
  if (!att) { const e = new Error('Anexo não encontrado'); e.status = 404; throw e; }
  // Apenas ADM/SAYGO ou quem fez o upload pode deletar
  if (!(user.role === 'ADM' || user.role === 'SAYGO' || att.uploadedById === user.id)) {
    const e = new Error('Sem permissão'); e.status = 403; throw e;
  }
  await prisma.kanbanAttachment.delete({ where: { id: attachmentId } });
  return { ok: true };
}

// ── Helpers expostos ─────────────────────────────────────────────────
export const KANBAN = { STAGES_ORDER, STAGE_META };
