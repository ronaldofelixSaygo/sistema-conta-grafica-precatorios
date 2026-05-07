import { prisma } from '../config/prisma.js';

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
  });
}

export async function createParceiro(data) {
  if (!data.nome) { const e=new Error('Nome obrigatório'); e.status=400; throw e; }
  return prisma.parceiro.create({
    data: {
      nome: data.nome,
      cnpj: data.cnpj || null,
      telefone: data.telefone || null,
      email: data.email || null,
      stages: sanitizeStages(data.stages),
      isSaygo: !!data.isSaygo,
      active:  data.active !== false,
      notes:   data.notes || null,
    },
  });
}

export async function updateParceiro(id, data) {
  const upd = {};
  if (data.nome     !== undefined) upd.nome = data.nome;
  if (data.cnpj     !== undefined) upd.cnpj = data.cnpj || null;
  if (data.telefone !== undefined) upd.telefone = data.telefone || null;
  if (data.email    !== undefined) upd.email = data.email || null;
  if (data.stages   !== undefined) upd.stages = sanitizeStages(data.stages);
  if (data.isSaygo  !== undefined) upd.isSaygo = !!data.isSaygo;
  if (data.active   !== undefined) upd.active = !!data.active;
  if (data.notes    !== undefined) upd.notes = data.notes || null;
  return prisma.parceiro.update({ where: { id }, data: upd });
}

export async function deleteParceiro(id) {
  return prisma.parceiro.delete({ where: { id } });
}
