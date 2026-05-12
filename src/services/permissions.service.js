import { prisma } from '../config/prisma.js';
import { ensureBuiltin as ensureBuiltinKinds } from './partnerKind.service.js';

const ROLES = ['ADM','SAYGO','PARTNER','CLIENT'];
const BEHAVIORS = ['ESCRITORIO','ARMADOR_LOGISTICO','OUTRO'];
const MODULES = [
  'dashboard','clientes','movimentacoes','saldos','comissoes',
  'relatorios','alertas','kanban','acionamentos','credit-requests','desoneracoes','parceiros',
  'usuarios','auditoria','chat','parametros',
];

// Default restrictions por COMPORTAMENTO (cada kind herda o default do behavior dele).
const DEFAULT_RESTRICTIONS_BY_BEHAVIOR = {
  ARMADOR_LOGISTICO: { clientes: ['percentualComissao','diaFechamento','parceiroSala','parceiroFilial','parceiroIe'] },
  OUTRO:             { clientes: ['percentualComissao','diaFechamento','parceiroSala','parceiroFilial','parceiroIe'] },
};
// CLIENT tem suas próprias restrições
const DEFAULT_RESTRICTIONS_CLIENT = {
  clientes: ['percentualComissao','diaFechamento','parceiroSala','parceiroFilial','parceiroIe'],
};

// Defaults por COMBINAÇÃO (role, behavior, módulo). Retorna { canView, canCreate, canEdit, canDelete }.
// PARTNER usa o behavior do kind dele.
function defaultsFor(role, behavior, mod) {
  if (role === 'ADM') return { canView:true, canCreate:true, canEdit:true, canDelete:true };
  if (role === 'SAYGO') return {
    canView:   !['parametros'].includes(mod),
    canCreate: ['clientes','movimentacoes','kanban','acionamentos','credit-requests','desoneracoes','parceiros','comissoes'].includes(mod),
    canEdit:   ['clientes','movimentacoes','kanban','acionamentos','credit-requests','desoneracoes','parceiros','comissoes'].includes(mod),
    canDelete: ['clientes','movimentacoes','kanban','acionamentos','credit-requests','desoneracoes','parceiros','comissoes'].includes(mod),
  };
  if (role === 'CLIENT') return {
    canView:   ['dashboard','clientes','movimentacoes','saldos','kanban','acionamentos','credit-requests','desoneracoes','chat'].includes(mod),
    canCreate: ['acionamentos','credit-requests'].includes(mod),
    canEdit:   false,
    canDelete: false,
  };
  if (role === 'PARTNER') {
    if (behavior === 'ESCRITORIO') return {
      canView:   ['dashboard','clientes','movimentacoes','saldos','comissoes','relatorios','alertas','kanban','acionamentos','credit-requests','desoneracoes','chat'].includes(mod),
      canCreate: ['clientes','movimentacoes','kanban','acionamentos','desoneracoes','comissoes'].includes(mod),
      canEdit:   ['clientes','movimentacoes','kanban','acionamentos','credit-requests','desoneracoes','comissoes'].includes(mod),
      canDelete: ['clientes','movimentacoes','kanban','acionamentos','comissoes'].includes(mod),
    };
    // ARMADOR_LOGISTICO e OUTRO: só Kanban e Chat
    return {
      canView:   ['kanban','chat'].includes(mod),
      canCreate: ['kanban'].includes(mod),
      canEdit:   ['kanban'].includes(mod),
      canDelete: false,
    };
  }
  return { canView:false, canCreate:false, canEdit:false, canDelete:false };
}

function defaultRestrictionsFor(role, behavior, mod) {
  if (role === 'CLIENT') return DEFAULT_RESTRICTIONS_CLIENT[mod] || [];
  if (role === 'PARTNER' && behavior && behavior !== 'ESCRITORIO') {
    return DEFAULT_RESTRICTIONS_BY_BEHAVIOR[behavior]?.[mod] || [];
  }
  return [];
}

// Constrói o array completo de defaults: 1 row por (ADM/SAYGO/CLIENT × módulo) +
// 1 row por (PARTNER × cada kind ativo × módulo).
async function buildDefaults() {
  await ensureBuiltinKinds();
  const kinds = await prisma.partnerKind.findMany({ orderBy: { sort: 'asc' } });
  const out = [];
  for (const mod of MODULES) {
    // Roles sem kind (ADM, SAYGO, CLIENT)
    for (const role of ['ADM','SAYGO','CLIENT']) {
      const d = defaultsFor(role, null, mod);
      out.push({
        role, partnerType: null, partnerKindCode: null, module: mod,
        ...d, restrictedFields: defaultRestrictionsFor(role, null, mod),
      });
    }
    // PARTNER × cada kind
    for (const k of kinds) {
      const d = defaultsFor('PARTNER', k.behavior, mod);
      out.push({
        role: 'PARTNER',
        partnerType: k.behavior,
        partnerKindCode: k.code,
        module: mod,
        ...d,
        restrictedFields: defaultRestrictionsFor('PARTNER', k.behavior, mod),
      });
    }
  }
  return out;
}

// Backfill: para rows legadas com partnerType setado e partnerKindCode nulo,
// usa o partnerType como kindCode (porque os builtin codes batem com o enum).
let _backfillDone = false;
async function backfillKindCode() {
  if (_backfillDone) return;
  try {
    await prisma.$executeRawUnsafe(`
      UPDATE role_permissions
      SET "partnerKindCode" = "partnerType"::text
      WHERE role = 'PARTNER' AND "partnerKindCode" IS NULL AND "partnerType" IS NOT NULL
    `);
    _backfillDone = true;
  } catch (e) {
    console.warn('[permissions] backfill kindCode falhou:', e.message);
  }
}

// Flag de boot: ensureDefaults só efetivamente roda na 1ª chamada do processo.
let _defaultsEnsured = false;
let _defaultsPromise = null;

export async function ensureDefaults() {
  if (_defaultsEnsured) return;
  if (_defaultsPromise) return _defaultsPromise;
  _defaultsPromise = (async () => {
    try {
      await backfillKindCode();
      const data = await buildDefaults();
      await prisma.rolePermission.createMany({ data, skipDuplicates: true });
      _defaultsEnsured = true;
    } catch (e) {
      _defaultsPromise = null;
      throw e;
    }
  })();
  return _defaultsPromise;
}

// Re-seeda perms pra um kind específico (chamado quando um novo kind é criado).
export async function ensureDefaultsForKind(kindCode) {
  const k = await prisma.partnerKind.findUnique({ where: { code: kindCode } });
  if (!k) return;
  const data = MODULES.map(mod => {
    const d = defaultsFor('PARTNER', k.behavior, mod);
    return {
      role: 'PARTNER',
      partnerType: k.behavior,
      partnerKindCode: k.code,
      module: mod,
      ...d,
      restrictedFields: defaultRestrictionsFor('PARTNER', k.behavior, mod),
    };
  });
  await prisma.rolePermission.createMany({ data, skipDuplicates: true });
  invalidatePermsCache();
}

export async function listAll() {
  await ensureDefaults();
  return prisma.rolePermission.findMany({
    orderBy: [{ role: 'asc' }, { partnerKindCode: 'asc' }, { module: 'asc' }],
  });
}

// Retorna a lista dinâmica de perfis (uma "coluna" da matriz) com base
// nos kinds ativos. Frontend usa isso pra montar o cabeçalho da tabela.
export async function listProfiles() {
  await ensureBuiltinKinds();
  const kinds = await prisma.partnerKind.findMany({
    where: { active: true },
    orderBy: { sort: 'asc' },
  });
  return [
    { key: 'ADM',    role: 'ADM',     partnerKindCode: null, label: 'Administrador' },
    { key: 'SAYGO',  role: 'SAYGO',   partnerKindCode: null, label: 'Saygo' },
    ...kinds.map(k => ({
      key: `PARTNER_${k.code}`,
      role: 'PARTNER',
      partnerKindCode: k.code,
      label: k.label,
      behavior: k.behavior,
    })),
    { key: 'CLIENT', role: 'CLIENT',  partnerKindCode: null, label: 'Cliente' },
  ];
}

export async function update(id, data) {
  const exists = await prisma.rolePermission.findUnique({ where: { id } });
  if (!exists) { const e = new Error(`RolePermission ${id} nao encontrado`); e.status = 404; throw e; }
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
  if (Object.keys(upd).length === 0) return exists;
  const r = await prisma.rolePermission.update({ where: { id }, data: upd });
  invalidatePermsCache();
  return r;
}

export async function resetToDefaults() {
  await prisma.rolePermission.deleteMany({});
  const data = await buildDefaults();
  await prisma.rolePermission.createMany({ data });
  _defaultsEnsured = true;
  invalidatePermsCache();
  return { ok: true };
}

// === Permissões efetivas para um usuário ===
// Cache em memória por chave de perfil (kindCode pra PARTNER, role pros demais).
const _permsCache = new Map();
const PERMS_TTL_MS = 30_000;
function invalidatePermsCache() { _permsCache.clear(); }

function cacheKeyForUser(user) {
  if (!user) return null;
  if (user.role === 'PARTNER') return `PARTNER:${user.partnerKindCode || user.partnerType || 'OUTRO'}`;
  return user.role;
}

export async function effectivePerms(user) {
  if (!user) return { modules: [], byModule: {}, profileKey: null };
  const cacheKey = cacheKeyForUser(user);
  const cached = _permsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.perms, role: user.role, partnerType: user.partnerType || null, partnerKindCode: user.partnerKindCode || null };
  }
  await ensureDefaults();

  // Monta filtro: PARTNER usa kindCode; demais usam null
  let where;
  if (user.role === 'PARTNER') {
    const code = user.partnerKindCode || user.partnerType || 'OUTRO';
    where = { role: 'PARTNER', partnerKindCode: code };
  } else {
    where = { role: user.role, partnerKindCode: null };
  }
  let rows = await prisma.rolePermission.findMany({ where });
  // Fallback: usuário PARTNER cujo kindCode não está na tabela (kind recém-criado
  // mas perms ainda não seedadas). Usa o behavior como fallback.
  if (user.role === 'PARTNER' && rows.length === 0 && user.partnerType) {
    rows = await prisma.rolePermission.findMany({
      where: { role: 'PARTNER', partnerType: user.partnerType },
    });
  }
  const byModule = {};
  const modules = [];
  for (const r of rows) {
    byModule[r.module] = {
      canView: r.canView, canCreate: r.canCreate, canEdit: r.canEdit, canDelete: r.canDelete,
      restrictedFields: Array.isArray(r.restrictedFields) ? r.restrictedFields : [],
    };
    if (r.canView) modules.push(r.module);
  }
  const perms = { modules, byModule, profileKey: cacheKey };
  _permsCache.set(cacheKey, { perms, expiresAt: Date.now() + PERMS_TTL_MS });
  return { ...perms, role: user.role, partnerType: user.partnerType || null, partnerKindCode: user.partnerKindCode || null };
}

// Helper síncrono para lookup com perms já carregadas
export function applyRestrictions(record, fields) {
  if (!record || !fields?.length) return record;
  const out = { ...record };
  for (const f of fields) delete out[f];
  return out;
}

// Invalidação externa (chamada pelo partnerKind service quando um kind é criado/editado/deletado)
export { invalidatePermsCache };

export const META = { ROLES, BEHAVIORS, MODULES };

// Helper exportado para o controller
export { MODULES };
