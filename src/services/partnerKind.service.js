// =====================================================================
// PartnerKind — cadastro de tipos de interveniente aduaneiro.
//
// Os 3 tipos built-in (ESCRITORIO, ARMADOR_LOGISTICO, OUTRO) são criados
// automaticamente no boot. O admin pode adicionar outros (ex.: CONTABILIDADE,
// DESPACHANTE) e cada um se vincula a um "behavior" (capacidade) — que é o
// que o restante do código consulta pra decidir o que o tipo pode fazer.
// =====================================================================
import { prisma } from '../config/prisma.js';

// Cache simples por código, com TTL curto.
const _kindsCache = new Map(); // code -> { kind, expiresAt }
const KIND_TTL_MS = 60_000;

function invalidateKindCache(code) {
  if (code) _kindsCache.delete(code);
  else _kindsCache.clear();
}

const BUILTIN = [
  {
    code: 'ESCRITORIO',
    label: 'Escritório (acessa clientes, movs, comissões)',
    behavior: 'ESCRITORIO',
    description: 'Tipo que tem acesso completo aos módulos operacionais.',
    sort: 1,
  },
  {
    code: 'ARMADOR_LOGISTICO',
    label: 'Armador Logístico (somente Kanban)',
    behavior: 'ARMADOR_LOGISTICO',
    description: 'Acesso restrito ao quadro Kanban e Chat.',
    sort: 2,
  },
  {
    code: 'OUTRO',
    label: 'Outro',
    behavior: 'OUTRO',
    description: 'Tipo genérico — apenas Kanban e Chat por padrão.',
    sort: 3,
  },
];

let _builtinEnsured = false;
let _builtinPromise = null;

export async function ensureBuiltin() {
  if (_builtinEnsured) return;
  if (_builtinPromise) return _builtinPromise;
  _builtinPromise = (async () => {
    try {
      await prisma.partnerKind.createMany({
        data: BUILTIN.map(b => ({ ...b, isBuiltin: true, active: true })),
        skipDuplicates: true,
      });
      _builtinEnsured = true;
    } catch (e) {
      _builtinPromise = null;
      throw e;
    }
  })();
  return _builtinPromise;
}

export async function listAll() {
  await ensureBuiltin();
  return prisma.partnerKind.findMany({
    orderBy: [{ sort: 'asc' }, { label: 'asc' }],
  });
}

export async function listActive() {
  await ensureBuiltin();
  return prisma.partnerKind.findMany({
    where: { active: true },
    orderBy: [{ sort: 'asc' }, { label: 'asc' }],
  });
}

export async function getByCode(code) {
  if (!code) return null;
  const cached = _kindsCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.kind;
  await ensureBuiltin();
  const kind = await prisma.partnerKind.findUnique({ where: { code } });
  _kindsCache.set(code, { kind, expiresAt: Date.now() + KIND_TTL_MS });
  return kind;
}

function normalizeCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

export async function create(data) {
  const code = normalizeCode(data.code || data.label);
  if (!code) { const e = new Error('Código inválido'); e.status = 400; throw e; }
  const label = String(data.label || '').trim();
  if (!label) { const e = new Error('Label obrigatório'); e.status = 400; throw e; }
  const behavior = data.behavior || 'OUTRO';
  if (!['ESCRITORIO', 'ARMADOR_LOGISTICO', 'OUTRO'].includes(behavior)) {
    const e = new Error('Behavior inválido'); e.status = 400; throw e;
  }
  const existing = await prisma.partnerKind.findUnique({ where: { code } });
  if (existing) { const e = new Error(`Já existe tipo com código "${code}"`); e.status = 409; throw e; }
  const r = await prisma.partnerKind.create({
    data: {
      code,
      label: label.slice(0, 120),
      behavior,
      description: data.description ? String(data.description).slice(0, 500) : null,
      active: data.active !== false,
      isBuiltin: false,
      sort: Number(data.sort) || 99,
    },
  });
  invalidateKindCache();
  return r;
}

export async function update(id, data) {
  const existing = await prisma.partnerKind.findUnique({ where: { id } });
  if (!existing) { const e = new Error('Tipo não encontrado'); e.status = 404; throw e; }
  const upd = {};
  // O code dos built-in não pode ser alterado.
  if (data.code !== undefined && !existing.isBuiltin) {
    const newCode = normalizeCode(data.code);
    if (!newCode) { const e = new Error('Código inválido'); e.status = 400; throw e; }
    if (newCode !== existing.code) {
      const dup = await prisma.partnerKind.findUnique({ where: { code: newCode } });
      if (dup) { const e = new Error(`Código "${newCode}" já em uso`); e.status = 409; throw e; }
      upd.code = newCode;
    }
  }
  if (data.label !== undefined) upd.label = String(data.label).trim().slice(0, 120);
  if (data.behavior !== undefined && !existing.isBuiltin) {
    if (!['ESCRITORIO', 'ARMADOR_LOGISTICO', 'OUTRO'].includes(data.behavior)) {
      const e = new Error('Behavior inválido'); e.status = 400; throw e;
    }
    upd.behavior = data.behavior;
  }
  if (data.description !== undefined) upd.description = data.description ? String(data.description).slice(0, 500) : null;
  if (data.active !== undefined) upd.active = !!data.active;
  if (data.sort !== undefined) upd.sort = Number(data.sort) || 0;
  if (Object.keys(upd).length === 0) return existing;
  const r = await prisma.partnerKind.update({ where: { id }, data: upd });
  invalidateKindCache();
  return r;
}

export async function remove(id) {
  const existing = await prisma.partnerKind.findUnique({ where: { id } });
  if (!existing) { const e = new Error('Tipo não encontrado'); e.status = 404; throw e; }
  if (existing.isBuiltin) {
    const e = new Error('Tipos built-in não podem ser excluídos. Use Desativar.'); e.status = 400; throw e;
  }
  // Bloqueia exclusão se há parceiros usando.
  const usage = await prisma.parceiro.count({ where: { kindCode: existing.code } });
  if (usage > 0) {
    const e = new Error(`Há ${usage} interveniente(s) usando esse tipo. Reatribua antes de excluir.`);
    e.status = 400; throw e;
  }
  await prisma.partnerKind.delete({ where: { id } });
  invalidateKindCache();
  return { ok: true };
}
