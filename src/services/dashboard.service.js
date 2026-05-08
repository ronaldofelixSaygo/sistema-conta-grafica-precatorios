import { prisma } from '../config/prisma.js';
import { clienteScope, movimentacaoScope } from '../utils/scope.js';

export async function getDashboard(user, q = {}) {
  const cliWhere = clienteScope(user);
  // Movimentacoes com filtros opcionais
  const movWhere = { AND: [movimentacaoScope(user)] };
  if (q.cliente_id) movWhere.AND.push({ clienteId: Number(q.cliente_id) });
  if (q.data_ini)   movWhere.AND.push({ dataNf: { gte: new Date(q.data_ini) } });
  if (q.data_fim)   movWhere.AND.push({ dataNf: { lte: new Date(q.data_fim) } });

  const [clientesCount, movsCount, creditos, debitos, usersCount, ultimas] = await Promise.all([
    prisma.cliente.count({ where: cliWhere }),
    prisma.movimentacao.count({ where: movWhere }),
    prisma.movimentacao.aggregate({
      where: { AND: [...movWhere.AND, { tipoMovimento: 'Créditos Reconhecidos e Cedidos' }] },
      _sum: { valorAjustado: true },
    }),
    prisma.movimentacao.aggregate({
      where: { AND: [...movWhere.AND, { tipoMovimento: 'Débitos de Liquidações' }] },
      _sum: { valorAjustado: true },
    }),
    user.role === 'ADM' ? prisma.user.count() : Promise.resolve(0),
    prisma.movimentacao.findMany({
      where: movWhere,
      orderBy: [{ dataNf: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      include: { cliente: { select: { id: true, nome: true, escritorio: true } } },
    }),
  ]);

  return {
    totals: {
      clientes: clientesCount,
      movimentacoes: movsCount,
      creditos: creditos._sum.valorAjustado || 0,
      debitos:  debitos._sum.valorAjustado  || 0,
      saldo:    (creditos._sum.valorAjustado || 0) + (debitos._sum.valorAjustado || 0),
      users:    usersCount,
    },
    ultimas: ultimas.map(m => ({
      id: m.id,
      cliente_id: m.clienteId,
      cliente_nome: m.cliente?.nome || '',
      escritorio: m.cliente?.escritorio || '',
      tipo_movimento: m.tipoMovimento,
      valor_ajustado: m.valorAjustado,
      data_nf: m.dataNf,
      created_at: m.createdAt,
    })),
  };
}
