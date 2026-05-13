import { prisma } from '../config/prisma.js';
import { clienteScope, movimentacaoScope } from '../utils/scope.js';

// Indicadores extras pra staff (ADM/SAYGO): contagem de processos do Kanban
// por etapa, créditos por status e desonerações por status. CLIENT/PARTNER
// não recebem esse bloco pra não inflar payload (eles têm telas próprias).
async function getStaffIndicators(user, q) {
  if (user.role !== 'ADM' && user.role !== 'SAYGO') return null;

  // Filtros de período opcionais sobre createdAt dos processos
  const dateRange = {};
  if (q.data_ini) dateRange.gte = new Date(q.data_ini);
  if (q.data_fim) dateRange.lte = new Date(q.data_fim);
  const hasDate = Object.keys(dateRange).length > 0;

  const [
    kanbanByStage, kanbanTotal,
    creditByStatus, creditTotal, creditOpen,
    desonByStatus,  desonTotal,  desonOpen,
  ] = await Promise.all([
    // Kanban: contagem por etapa atual
    prisma.kanbanCard.groupBy({
      by: ['currentStage'],
      _count: { _all: true },
      where: hasDate ? { startedAt: dateRange } : {},
    }),
    prisma.kanbanCard.count({ where: hasDate ? { startedAt: dateRange } : {} }),

    // Créditos: contagem por status
    prisma.creditRequest.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: hasDate ? { createdAt: dateRange } : {},
    }),
    prisma.creditRequest.count({ where: hasDate ? { createdAt: dateRange } : {} }),
    prisma.creditRequest.count({
      where: {
        ...(hasDate ? { createdAt: dateRange } : {}),
        status: { in: ['DRAFT', 'SENT', 'IN_PROGRESS'] },
      },
    }),

    // Desonerações: contagem por status + por etapa atual quando em aberto
    prisma.desoneracao.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: hasDate ? { createdAt: dateRange } : {},
    }),
    prisma.desoneracao.count({ where: hasDate ? { createdAt: dateRange } : {} }),
    prisma.desoneracao.count({
      where: { ...(hasDate ? { createdAt: dateRange } : {}), status: 'EM_ANDAMENTO' },
    }),
  ]);

  // Desonerações em aberto por etapa (currentStep) — pra montar o gráfico
  const desonOpenByStep = await prisma.desoneracao.groupBy({
    by: ['currentStep'],
    _count: { _all: true },
    where: { ...(hasDate ? { createdAt: dateRange } : {}), status: 'EM_ANDAMENTO' },
  });

  return {
    kanban: {
      total: kanbanTotal,
      porEtapa: kanbanByStage.map(r => ({ stage: r.currentStage, count: r._count._all })),
    },
    creditos: {
      total: creditTotal,
      emAberto: creditOpen,
      porStatus: creditByStatus.map(r => ({ status: r.status, count: r._count._all })),
    },
    desoneracoes: {
      total: desonTotal,
      emAberto: desonOpen,
      porStatus: desonByStatus.map(r => ({ status: r.status, count: r._count._all })),
      porEtapaEmAberto: desonOpenByStep.map(r => ({ step: r.currentStep, count: r._count._all })),
    },
  };
}

export async function getDashboard(user, q = {}) {
  const cliWhere = clienteScope(user);
  // Movimentacoes com filtros opcionais
  const movWhere = { AND: [movimentacaoScope(user)] };
  if (q.cliente_id) movWhere.AND.push({ clienteId: Number(q.cliente_id) });
  if (q.data_ini)   movWhere.AND.push({ dataNf: { gte: new Date(q.data_ini) } });
  if (q.data_fim)   movWhere.AND.push({ dataNf: { lte: new Date(q.data_fim) } });

  const [clientesCount, movsCount, creditos, debitos, usersCount, ultimas, staffIndicators] = await Promise.all([
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
    getStaffIndicators(user, q),
  ]);

  return {
    staff: staffIndicators,
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
