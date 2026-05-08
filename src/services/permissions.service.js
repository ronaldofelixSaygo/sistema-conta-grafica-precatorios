import { prisma } from '../config/prisma.js';

const ROLES = ['ADM','SAYGO','PARTNER','CLIENT'];
const PARTNER_TYPES = ['ESCRITORIO','ARMADOR_LOGISTICO','OUTRO'];
const MODULES = [
  'dashboard','clientes','movimentacoes','saldos','comissoes',
  'relatorios','alertas','kanban','acionamentos','parceiros',
  'usuarios','auditoria','chat','parametros',
];

// Coluns "perfis" exibidas no frontend = combinação role+partnerType
export const PROFILES = [
  { key: 'ADM',                   role: 'ADM',     partnerType: null },
  { key: 'SAYGO',                 role: 'SAYGO',   partnerType: null },
  { key: 'PARTNER_ESCRITORIO',    role: 'PARTNER', partnerType: 'ESCRITORIO' },
  { key: 'PARTNER_ARMADOR',       role: 'PARTNER', partnerType: 'ARMADOR_LOGISTICO' },
  { key: 'PARTNER_OUTRO',         role: 'PARTNER', partnerType: 'OUTRO' },
  { key: 'CLIENT',                role: 'CLIENT',  partnerType: null },
];

// Default: sensitive fields por (perfil, módulo) — chave inicial movível pra UI
const DEFAULT_RESTRICTIONS = {
  PARTNER_ARMADOR: { clientes: ['percentualComissao','diaFechamento','parceiroSala','parceiroFilial','parceiroIe'] },
  PARTNER_OUTRO:   { clientes: ['percentualComissao','diaFechamento','parceiroSala','parceiroFilial','parceiroIe'] },
};

function defaults() {
  const out = [];
  for (const p of PROFILES) {
    for (const m of MODULES) {
      let canView=false, canCreate=false, canEdit=false, canDelete=false;
      if (p.key === 'ADM') { canView=canCreate=canEdit=canDelete=true; }
      else if (p.key === 'SAYGO') {
        canView   = !['parametros'].includes(m);
        canCreate = ['clientes','movimentacoes','kanban','acionamentos','parceiros','comissoes'].includes(m);
        canEdit   = canCreate;
        canDelete = canCreate;
      } else if (p.key === 'PARTNER_ESCRITORIO') {
        canView   = ['dashboard','clientes','movimentacoes','saldos','comissoes','relatorios','alertas','kanban','acionamentos','chat'].includes(m);
        canCreate = ['clientes','movimentacoes','kanban','acionamentos','comissoes'].includes(m);
        canEdit   = canCreate;
        canDelete = canCreate;
      } else if (p.key === 'PARTNER_ARMADOR') {
        canView   = ['kanban','chat'].includes(m);  // armador: só Kanban e Chat por padrão
        canCreate = ['kanban'].includes(m);
        canEdit   = canCreate;
        canDelete = false;
      } else if (p.key === 'PARTNER_OUTRO') {
        canView   = ['kanban','chat'].includes(m);
        canCreate = ['kanban'].includes(m);
        canEdit   = canCreate;
        canDelete = false;
      } else if (p.key === 'CLIENT') {
        canView   = ['dashboard','clientes','movimentacoes','saldos','kanban','acionamentos','chat'].includes(m);
        canCreate = ['acionamentos'].includes(m);
        canEdit   = false;
        canDelete = false;
      }
      const restricted = DEFAULT_RESTRICTIONS[p.key]?.[m] || [];
      out.push({
        role: p.role, partnerType: p.partnerType, module: m,
        canView, canCreate, canEdit, canDelete,
        restrictedFields: restricted,
      });
    }
  }
  return out;
}

export async function ensureDefaults() {
  const count = await prisma.rolePermission.count();
  if (count > 0) return;
  await prisma.rolePermission.createMany({ data: defaults() });
}

export async function listAll() {
  await ensureDefaults();
  return prisma.rolePermission.findMany({
    orderBy: [{ role: 'asc' }, { partnerType: 'asc' }, { module: 'asc' }],
  });
}

export async function update(id, data) {
  // Verifica que o registro existe primeiro (debug-friendly)
  const exists = await prisma.rolePermission.findUnique({ where: { id } });
  if (!exists) {
    const e = new Error(`RolePermission ${id} nao encontrado`); e.status = 404; throw e;
  }
  const upd = {};
  if (data.canView   !== undefined) upd.canView   = !!data.canView;
  if (data.canCreate !== undefined) upd.canCreate = !!data.canCreate;
  if (data.canEdit   !== undefined) upd.canEdit   = !!data.canEdit;
  if (data.canDelete !== undefined) upd.canDelete = !!data.canDelete;
  if (data.restrictedFields !== undefined) {
    upd.restrictedFields = Array.isArray(data.restrictedFields)
      ? data.restrictedFields.filter(s => typeof s === 'string')
      : [];
  }
  if (Object.keys(upd).length === 0) return exists; // nada a atualizar
  return prisma.rolePermission.update({ where: { id }, data: upd });
}

export async function resetToDefaults() {
  await prisma.rolePermission.deleteMany({});
  await prisma.rolePermission.createMany({ data: defaults() });
  return { ok: true };
}

// === Permissões efetivas para um usuário ===
function profileKeyOf(user) {
  if (!user) return null;
  if (user.role !== 'PARTNER') return user.role;
  const t = user.partnerType || 'OUTRO';
  if (t === 'ESCRITORIO') return 'PARTNER_ESCRITORIO';
  if (t === 'ARMADOR_LOGISTICO') return 'PARTNER_ARMADOR';
  return 'PARTNER_OUTRO';
}
function profileFromKey(key) {
  return PROFILES.find(p => p.key === key);
}

// Retorna { modules: [], byModule: { mod: { canView, canCreate, canEdit, canDelete, restrictedFields }}}
export async function effectivePerms(user) {
  if (!user) return { modules: [], byModule: {}, profileKey: null };
  await ensureDefaults();
  const key = profileKeyOf(user);
  const p = profileFromKey(key);
  if (!p) return { modules: [], byModule: {}, profileKey: null };
  const rows = await prisma.rolePermission.findMany({
    where: { role: p.role, partnerType: p.partnerType },
  });
  const byModule = {};
  const modules = [];
  for (const r of rows) {
    byModule[r.module] = {
      canView: r.canView, canCreate: r.canCreate, canEdit: r.canEdit, canDelete: r.canDelete,
      restrictedFields: Array.isArray(r.restrictedFields) ? r.restrictedFields : [],
    };
    if (r.canView) modules.push(r.module);
  }
  return { modules, byModule, profileKey: key, role: user.role, partnerType: user.partnerType || null };
}

// Helper síncrono para lookup com perms já carregadas
export function applyRestrictions(record, fields) {
  if (!record || !fields?.length) return record;
  const out = { ...record };
  for (const f of fields) delete out[f];
  return out;
}

export const META = { ROLES, PARTNER_TYPES, MODULES, PROFILES };

// Helper exportado para o controller
export { MODULES };
