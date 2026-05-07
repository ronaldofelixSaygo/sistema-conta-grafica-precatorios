import { prisma } from '../config/prisma.js';
import { movimentacaoScope, clienteScope, canMutateMovimentacao } from '../utils/scope.js';

function calcValorAjustado(tipo, valor) {
  const v = Math.abs(Number(valor) || 0);
  if (!tipo) return 0;
  if (tipo.includes('Débito') || tipo.includes('Debito')) return -v;
  if (tipo.includes('Crédito') || tipo.includes('Credito')) return v;
  return 0;
}

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export async function listMovimentacoes(user, q = {}) {
  const {
    cliente_id, page = 1, limit = 50, search,
    f_cliente, f_tipo, f_duimp, f_parceiro,
    f_data_ini, f_data_fim, f_valor_min, f_valor_max,
    sort_by, sort_dir,
  } = q;

  const AND = [movimentacaoScope(user)];
  if (cliente_id) AND.push({ clienteId: Number(cliente_id) });
  if (search) AND.push({
    OR: [
      { cliente: { nome: { contains: search, mode: 'insensitive' } } },
      { duimpDiProcesso: { contains: search, mode: 'insensitive' } },
    ],
  });
  if (f_cliente)  AND.push({ cliente: { nome: { contains: f_cliente,  mode: 'insensitive' } } });
  if (f_tipo)     AND.push({ tipoMovimento:   { contains: f_tipo,     mode: 'insensitive' } });
  if (f_duimp)    AND.push({ duimpDiProcesso: { contains: f_duimp,    mode: 'insensitive' } });
  if (f_parceiro) AND.push({ parceiro:        { contains: f_parceiro, mode: 'insensitive' } });
  if (f_data_ini) AND.push({ dataNf: { gte: parseDate(f_data_ini) } });
  if (f_data_fim) AND.push({ dataNf: { lte: parseDate(f_data_fim) } });
  if (f_valor_min) AND.push({ valorAjustado: { gte: Number(f_valor_min) } });
  if (f_valor_max) AND.push({ valorAjustado: { lte: Number(f_valor_max) } });

  const where = { AND };

  const sortMap = {
    cliente_nome:      { cliente: { nome: 'asc' } },
    tipo_movimento:    { tipoMovimento: 'asc' },
    data_nf:           { dataNf: 'asc' },
    duimp_di_processo: { duimpDiProcesso: 'asc' },
    parceiro:          { parceiro: 'asc' },
    valor_ajustado:    { valorAjustado: 'asc' },
  };
  const dir = (sort_dir || 'desc').toUpperCase() === 'ASC' ? 'asc' : 'desc';
  const baseSort = sortMap[sort_by] || { dataNf: 'asc' };
  const orderBy = JSON.parse(JSON.stringify(baseSort));
  const setDir = (obj) => {
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'object') setDir(obj[k]); else obj[k] = dir;
    }
  };
  setDir(orderBy);

  const take = Math.max(1, parseInt(limit, 10) || 50);
  const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * take;

  const [items, total] = await Promise.all([
    prisma.movimentacao.findMany({
      where, orderBy, take, skip,
      include: { cliente: { select: { id: true, nome: true, escritorio: true } } },
    }),
    prisma.movimentacao.count({ where }),
  ]);

  // Achata a saída no formato compatível com o frontend antigo
  const flat = items.map(m => ({
    id: m.id,
    cliente_id: m.clienteId,
    cliente_nome: m.cliente?.nome || '',
    tipo_movimento: m.tipoMovimento,
    data_nf: m.dataNf,
    duimp_di_processo: m.duimpDiProcesso,
    parceiro: m.parceiro,
    data_exoneracao: m.dataExoneracao,
    percentual: m.percentual,
    valor: m.valor,
    valor_ajustado: m.valorAjustado,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  }));

  return { items: flat, total, page: Number(page) || 1, pages: Math.ceil(total / take) };
}

async function resolveClienteForMutation(user, clienteId) {
  const id = Number(clienteId);
  const cli = await prisma.cliente.findFirst({ where: { ...clienteScope(user), id } });
  if (!cli) { const e = new Error('Cliente não encontrado ou fora do escopo'); e.status = 404; throw e; }
  return cli;
}

export async function createMovimentacao(user, data) {
  if (!canMutateMovimentacao(user)) { const e=new Error('Sem permissão'); e.status=403; throw e; }
  const cli = await resolveClienteForMutation(user, data.cliente_id || data.clienteId);
  const tipo = data.tipo_movimento || data.tipoMovimento;
  return prisma.movimentacao.create({
    data: {
      clienteId: cli.id,
      tipoMovimento: tipo,
      dataNf:           parseDate(data.data_nf || data.dataNf),
      duimpDiProcesso:  data.duimp_di_processo || data.duimpDiProcesso || null,
      parceiro:         cli.escritorio || null,
      dataExoneracao:   parseDate(data.data_exoneracao || data.dataExoneracao),
      percentual:       Number(data.percentual) || 0,
      valor:            Number(data.valor) || 0,
      valorAjustado:    calcValorAjustado(tipo, data.valor),
    },
  });
}

export async function updateMovimentacao(user, id, data) {
  if (!canMutateMovimentacao(user)) { const e=new Error('Sem permissão'); e.status=403; throw e; }

  // A movimentação precisa estar dentro do escopo (parceiro só edita as do escritório dele)
  const exists = await prisma.movimentacao.findFirst({
    where: { AND: [movimentacaoScope(user), { id: Number(id) }] },
  });
  if (!exists) { const e=new Error('Lançamento não encontrado'); e.status=404; throw e; }

  const cli = await resolveClienteForMutation(user, data.cliente_id || data.clienteId || exists.clienteId);
  const tipo = data.tipo_movimento || data.tipoMovimento || exists.tipoMovimento;

  return prisma.movimentacao.update({
    where: { id: Number(id) },
    data: {
      clienteId: cli.id,
      tipoMovimento: tipo,
      dataNf:          parseDate(data.data_nf || data.dataNf),
      duimpDiProcesso: data.duimp_di_processo || data.duimpDiProcesso || null,
      parceiro:        cli.escritorio || null,
      dataExoneracao:  parseDate(data.data_exoneracao || data.dataExoneracao),
      percentual:      Number(data.percentual) || 0,
      valor:           Number(data.valor) || 0,
      valorAjustado:   calcValorAjustado(tipo, data.valor),
    },
  });
}

export async function deleteMovimentacao(user, id) {
  if (!canMutateMovimentacao(user)) { const e=new Error('Sem permissão'); e.status=403; throw e; }
  const exists = await prisma.movimentacao.findFirst({
    where: { AND: [movimentacaoScope(user), { id: Number(id) }] },
  });
  if (!exists) { const e=new Error('Lançamento não encontrado'); e.status=404; throw e; }
  return prisma.movimentacao.delete({ where: { id: Number(id) } });
}
