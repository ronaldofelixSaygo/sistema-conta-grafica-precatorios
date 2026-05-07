import { prisma } from '../config/prisma.js';
import { clienteScope, movimentacaoScope } from '../utils/scope.js';

export async function getDashboard(user) {
  const cliWhere = clienteScope(user);
  const movWhere = movimentacaoScope(user);

  const [clientesCount, movsCount, creditos, debitos, usersCount, ultimas] = await Promise.all([
    prisma.cliente.count({ where: cliWhere }),
    prisma.movimentacao.count({ where: movWhere }),
    prisma.movimentacao.aggregate({
      where: { AND: [movWhere, { tipoMovimento: 'Créditos Reconhecidos e Cedidos' }] },
      _sum: { valorAjustado: true },
    }),
    prisma.movimentacao.aggregate({
      where: { AND: [movWhere, { tipoMovimento: 'Débitos de Liquidações' }] },
      _sum: { valorAjustado: true },
    }),
    user.role === 'ADM' ? prisma.user.count() : Promise.resolve(0),
    prisma.movimentacao.findMany({
      where: movWhere,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { cliente: { select: { nome: true } } },
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
      cliente_nome: m.cliente?.nome || '',
      tipo_movimento: m.tipoMovimento,
      valor_ajustado: m.valorAjustado,
      data_nf: m.dataNf,
      created_at: m.createdAt,
    })),
  };
}
