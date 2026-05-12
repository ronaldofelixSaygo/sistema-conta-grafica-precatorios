import { prisma } from '../config/prisma.js';
import { getByCode as getKindByCode, ensureBuiltin } from './partnerKind.service.js';

// stages agora sao keys dinamicas de KanbanStageDef. Validamos minimamente:
function sanitizeStages(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(s => typeof s === 'string' && /^[A-Z0-9_]+$/.test(s));
}

export async function listParceiros({ stage } = {}) {
  const where = { active: true };
  if (stage) where.stages = { has: stage };
  return prisma.parceiro.findMany({
    where, orderBy: [{ isSaygo: 'desc' }, { nome: 'asc' }],
    include: { kind: { select: { code: true, label: true, behavior: true } } },
  });
}

const VALID_BEHAVIORS = ['ESCRITORIO','ARMADOR_LOGISTICO','OUTRO'];

// Resolve kindCode + behavior a partir do payload. Aceita:
//   - kindCode explícito (cadastro novo) — looks up no PartnerKind
//   - type legado (ESCRITORIO/ARMADOR_LOGISTICO/OUTRO) — vira kindCode + behavior idênticos
async function resolveKindAndBehavior(data) {
  await ensureBuiltin();
  const wantedCode = data.kindCode || data.type;
  if (!wantedCode) return { kindCode: 'OUTRO', type: 'OUTRO' };
  const kind = await getKindByCode(String(wantedCode).toUpperCase());
  if (kind && kind.active) {
    return { kindCode: kind.code, type: kind.behavior };
  }
  // Fallback: trata payload como behavior legado.
  const beh = VALID_BEHAVIORS.includes(String(wantedCode).toUpperCase())
    ? String(wantedCode).toUpperCase()
    : 'OUTRO';
  return { kindCode: beh, type: beh };
}

export async function createParceiro(data) {
  if (!data.nome) { const e=new Error('Nome obrigatório'); e.status=400; throw e; }
  const { kindCode, type } = await resolveKindAndBehavior(data);
  return prisma.parceiro.create({
    data: {
      // .trim() preventivo: o `nome` vira o "escritorio" string nos clientes,
      // e qualquer espaço invisível quebra o match no scope (case PARTNER).
      nome: String(data.nome).trim(),
      cnpj: data.cnpj || null,
      telefone: data.telefone || null,
      email: data.email || null,
      type,
      kindCode,
      stages: sanitizeStages(data.stages),
      isSaygo: !!data.isSaygo,
      active:  data.active !== false,
      notes:   data.notes || null,
    },
  });
}

export async function updateParceiro(id, data) {
  const upd = {};
  if (data.nome     !== undefined) upd.nome = String(data.nome).trim();
  if (data.cnpj     !== undefined) upd.cnpj = data.cnpj || null;
  if (data.telefone !== undefined) upd.telefone = data.telefone || null;
  if (data.email    !== undefined) upd.email = data.email || null;
  if (data.stages   !== undefined) upd.stages = sanitizeStages(data.stages);
  if (data.isSaygo  !== undefined) upd.isSaygo = !!data.isSaygo;
  if (data.active   !== undefined) upd.active = !!data.active;
  if (data.notes    !== undefined) upd.notes = data.notes || null;
  // type/kindCode podem chegar separados ou juntos
  if (data.kindCode !== undefined || data.type !== undefined) {
    const { kindCode, type } = await resolveKindAndBehavior(data);
    upd.kindCode = kindCode;
    upd.type = type;
  }
  return prisma.parceiro.update({ where: { id }, data: upd });
}

export async function deleteParceiro(id) {
  return prisma.parceiro.delete({ where: { id } });
}
