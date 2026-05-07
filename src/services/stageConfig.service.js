import { prisma } from '../config/prisma.js';
import { STAGES_ORDER, STAGE_META } from '../utils/kanban.constants.js';

// Garante que existem registros padrao para todas as etapas (idempotente).
export async function ensureDefaults() {
  for (let i = 0; i < STAGES_ORDER.length; i++) {
    const stage = STAGES_ORDER[i];
    const meta = STAGE_META[stage];
    const exists = await prisma.kanbanStageConfig.findUnique({ where: { stage } });
    if (exists) continue;
    await prisma.kanbanStageConfig.create({
      data: {
        stage,
        label: meta.label,
        order: i,
        slaHours: meta.slaHours,
        defaultResponsibleRole: meta.responsibleRole || null,
        checklist: (meta.defaultChecklist || []).map(it => it.label || it),
        active: true,
      },
    });
  }
}

export async function listConfigs() {
  await ensureDefaults();
  return prisma.kanbanStageConfig.findMany({ orderBy: { order: 'asc' } });
}

export async function updateConfig(stage, data) {
  await ensureDefaults();
  const upd = {};
  if (data.label                 !== undefined) upd.label = String(data.label || '');
  if (data.slaHours              !== undefined) upd.slaHours = Number(data.slaHours) || 0;
  if (data.defaultResponsibleRole !== undefined) upd.defaultResponsibleRole = data.defaultResponsibleRole || null;
  if (data.active                !== undefined) upd.active = !!data.active;
  if (data.checklist             !== undefined) {
    upd.checklist = Array.isArray(data.checklist)
      ? data.checklist.map(s => String(s).trim()).filter(Boolean)
      : [];
  }
  return prisma.kanbanStageConfig.update({ where: { stage }, data: upd });
}

// Retorna a config (com fallback para defaults se nao houver no banco)
export async function getEffectiveConfig(stage) {
  const cfg = await prisma.kanbanStageConfig.findUnique({ where: { stage } });
  if (cfg) return cfg;
  const meta = STAGE_META[stage];
  return {
    stage, label: meta.label, slaHours: meta.slaHours,
    defaultResponsibleRole: meta.responsibleRole || null,
    checklist: (meta.defaultChecklist || []).map(it => it.label || it),
    active: true,
  };
}
