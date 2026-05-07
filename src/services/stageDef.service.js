import { prisma } from '../config/prisma.js';
import { STAGES_ORDER, STAGE_META } from '../utils/kanban.constants.js';

// Garante que existe pelo menos o conjunto default. Idempotente.
export async function ensureDefaults() {
  const count = await prisma.kanbanStageDef.count();
  if (count > 0) return;
  for (let i = 0; i < STAGES_ORDER.length; i++) {
    const key = STAGES_ORDER[i];
    const meta = STAGE_META[key];
    const stg = await prisma.kanbanStageDef.create({
      data: {
        key, label: meta.label, order: i,
        slaHours: meta.slaHours,
        defaultResponsibleRole: meta.responsibleRole || null,
        active: true,
        isFinal: key === 'CONCLUIDO',
      },
    });
    const items = (meta.defaultChecklist || []).map((it, idx) => ({
      stageId: stg.id,
      label: typeof it === 'string' ? it : it.label,
      order: idx,
      active: true,
    }));
    if (items.length) await prisma.kanbanActivityDef.createMany({ data: items });
  }
}

// Lista todas as etapas (ativas e inativas), com atividades.
export async function listAll() {
  await ensureDefaults();
  return prisma.kanbanStageDef.findMany({
    orderBy: { order: 'asc' },
    include: { activities: { orderBy: { order: 'asc' } } },
  });
}

// Lista apenas etapas ativas (com suas atividades ativas) — usado pelo Kanban.
export async function listActive() {
  await ensureDefaults();
  return prisma.kanbanStageDef.findMany({
    where: { active: true },
    orderBy: { order: 'asc' },
    include: { activities: { where: { active: true }, orderBy: { order: 'asc' } } },
  });
}

export async function getStageByKey(key) {
  return prisma.kanbanStageDef.findUnique({
    where: { key },
    include: { activities: { orderBy: { order: 'asc' } } },
  });
}

// === ETAPAS ===

export async function createStage(data) {
  if (!data.label) { const e = new Error('Label obrigatório'); e.status = 400; throw e; }
  // Gera key estável a partir do label se não enviada
  const key = (data.key || data.label)
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!key) { const e = new Error('Key inválida'); e.status = 400; throw e; }
  const exists = await prisma.kanbanStageDef.findUnique({ where: { key } });
  if (exists) { const e = new Error('Já existe etapa com essa chave'); e.status = 409; throw e; }
  // ordem: depois da última
  const last = await prisma.kanbanStageDef.findFirst({ orderBy: { order: 'desc' } });
  const nextOrder = (last?.order ?? -1) + 1;
  return prisma.kanbanStageDef.create({
    data: {
      key, label: data.label,
      order:    data.order != null ? Number(data.order) : nextOrder,
      slaHours: Number(data.slaHours) || 72,
      defaultResponsibleRole: data.defaultResponsibleRole || null,
      active:   data.active !== false,
      isFinal:  !!data.isFinal,
    },
    include: { activities: true },
  });
}

export async function updateStage(id, data) {
  const upd = {};
  if (data.label                  !== undefined) upd.label    = String(data.label || '');
  if (data.order                  !== undefined) upd.order    = Number(data.order) || 0;
  if (data.slaHours               !== undefined) upd.slaHours = Number(data.slaHours) || 0;
  if (data.defaultResponsibleRole !== undefined) upd.defaultResponsibleRole = data.defaultResponsibleRole || null;
  if (data.active                 !== undefined) upd.active   = !!data.active;
  if (data.isFinal                !== undefined) upd.isFinal  = !!data.isFinal;
  return prisma.kanbanStageDef.update({ where: { id }, data: upd });
}

export async function deleteStage(id) {
  const stg = await prisma.kanbanStageDef.findUnique({ where: { id } });
  if (!stg) { const e = new Error('Etapa não encontrada'); e.status = 404; throw e; }
  // Bloqueia exclusão se houver progresso vinculado a essa etapa
  const used = await prisma.kanbanStageProgress.count({ where: { stage: stg.key } });
  const usedAsCurrent = await prisma.kanbanCard.count({ where: { currentStage: stg.key } });
  if (used > 0 || usedAsCurrent > 0) {
    const e = new Error('Não é possível excluir: existem cards usando essa etapa. Inative em vez de excluir.');
    e.status = 409; throw e;
  }
  await prisma.kanbanStageDef.delete({ where: { id } });
  return { ok: true };
}

// === ATIVIDADES ===

export async function createActivity(stageId, data) {
  if (!data.label) { const e = new Error('Label obrigatório'); e.status = 400; throw e; }
  const last = await prisma.kanbanActivityDef.findFirst({ where: { stageId }, orderBy: { order: 'desc' } });
  return prisma.kanbanActivityDef.create({
    data: {
      stageId,
      label: data.label,
      order: (last?.order ?? -1) + 1,
      active: data.active !== false,
    },
  });
}

export async function updateActivity(id, data) {
  const upd = {};
  if (data.label  !== undefined) upd.label  = String(data.label || '');
  if (data.order  !== undefined) upd.order  = Number(data.order) || 0;
  if (data.active !== undefined) upd.active = !!data.active;
  return prisma.kanbanActivityDef.update({ where: { id }, data: upd });
}

export async function deleteActivity(id) {
  await prisma.kanbanActivityDef.delete({ where: { id } });
  return { ok: true };
}

// Helpers para o service do Kanban
export async function getStagesOrdered() {
  return listActive(); // já vem ordenado e ativo
}

export async function nextActiveStageKey(currentKey) {
  const stages = await getStagesOrdered();
  const idx = stages.findIndex(s => s.key === currentKey);
  if (idx < 0 || idx >= stages.length - 1) return null;
  return stages[idx + 1].key;
}
