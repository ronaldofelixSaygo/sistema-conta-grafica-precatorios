import { prisma } from '../config/prisma.js';
import { clienteScope, movimentacaoScope } from '../utils/scope.js';
import { getStorageUsage, checkAndAlertIfNeeded } from './storageAlert.service.js';
import { computeBusinessDeadline, getSlaContext } from './sla.service.js';

// Defaults caso não exista config no banco. A leitura usa CreditSlaConfig.
const CREDIT_SLA_TO_START_H_DEFAULT   = 24;
const CREDIT_SLA_TO_RESOLVE_H_DEFAULT = 72;
const MS_PER_H = 3600 * 1000;

async function getCreditSlaHours() {
  try {
    const rows = await prisma.creditSlaConfig.findMany();
    const m = new Map(rows.map(r => [r.fase, r.slaHours]));
    return {
      toStart:   m.get('SENT_TO_PROGRESS')        ?? CREDIT_SLA_TO_START_H_DEFAULT,
      toResolve: m.get('IN_PROGRESS_TO_RESOLVED') ?? CREDIT_SLA_TO_RESOLVE_H_DEFAULT,
    };
  } catch {
    return { toStart: CREDIT_SLA_TO_START_H_DEFAULT, toResolve: CREDIT_SLA_TO_RESOLVE_H_DEFAULT };
  }
}

// % aderência: stages dentro do prazo / total avaliável.
// Para cada item retorna { okCount, totalCount, percent }.
function aderencia(okCount, totalCount) {
  const total = totalCount || 0;
  const ok = okCount || 0;
  return { ok, total, percent: total === 0 ? null : Math.round((ok / total) * 100) };
}

// Calcula SLA do Kanban a partir dos KanbanStageProgress.
// Conta etapas IN_PROGRESS (now < deadline) + COMPLETED (concluída antes do deadline).
// Etapas PENDING não contam (ainda não começaram).
async function getKanbanSlaAderencia(prisma, hasDate, dateRange, ctx) {
  const stages = await prisma.kanbanStageProgress.findMany({
    where: {
      status: { in: ['IN_PROGRESS', 'COMPLETED'] },
      startedAt: { not: null, ...(hasDate ? dateRange : {}) },
    },
    select: { status: true, slaHours: true, startedAt: true, completedAt: true },
  });
  let ok = 0;
  for (const s of stages) {
    // Prazo em horário comercial (dias úteis, pulando feriados)
    const deadline = computeBusinessDeadline(s.startedAt, s.slaHours || 72, ctx);
    if (s.status === 'COMPLETED') {
      if (!deadline) ok++;
      else if (s.completedAt && s.completedAt <= deadline) ok++;
    } else {
      // IN_PROGRESS: ainda dentro do prazo conta como OK
      if (!deadline || new Date() <= deadline) ok++;
    }
  }
  return aderencia(ok, stages.length);
}

// SLA de desoneração: cada etapa tem startedAt + slaHours (config), avalia
// completedAt (se concluída) ou now (em andamento). Junta config por etapa.
async function getDesoneracaoSlaAderencia(prisma, hasDate, dateRange, ctx) {
  const [steps, configs] = await Promise.all([
    prisma.desoneracaoStep.findMany({
      where: { startedAt: { not: null, ...(hasDate ? dateRange : {}) } },
      select: { etapa: true, startedAt: true, completedAt: true },
    }),
    prisma.desoneracaoStepConfig.findMany({ select: { etapa: true, slaHours: true } }),
  ]);
  const slaByEtapa = new Map(configs.map(c => [c.etapa, c.slaHours || 48]));
  let ok = 0;
  for (const s of steps) {
    const sla = slaByEtapa.get(s.etapa) || 48;
    // Prazo em horário comercial (dias úteis, pulando feriados)
    const deadline = computeBusinessDeadline(s.startedAt, sla, ctx);
    if (s.completedAt) {
      if (!deadline || s.completedAt <= deadline) ok++;
    } else {
      if (!deadline || new Date() <= deadline) ok++;
    }
  }
  return aderencia(ok, steps.length);
}

// SLA de Crédito: avalia 2 transições — SENT→IN_PROGRESS (CREDIT_SLA_TO_START_H)
// e IN_PROGRESS→RESOLVED (CREDIT_SLA_TO_RESOLVE_H). Cada uma vira uma "etapa".
async function getCreditoSlaAderencia(prisma, hasDate, dateRange, ctx) {
  const [requests, sla] = await Promise.all([
    prisma.creditRequest.findMany({
      where: { sentAt: { not: null, ...(hasDate ? dateRange : {}) } },
      select: { status: true, sentAt: true, inProgressAt: true, resolvedAt: true },
    }),
    getCreditSlaHours(),
  ]);
  let ok = 0;
  let total = 0;
  const now = new Date();
  // ok se não há prazo (SLA 0) ou se o evento ocorreu até o prazo
  const meets = (deadline, when) => !deadline || (when && when <= deadline);
  for (const r of requests) {
    // Fase 1: SENT → IN_PROGRESS (ou ainda aguardando) — prazo em horário comercial
    total++;
    const d1 = computeBusinessDeadline(r.sentAt, sla.toStart, ctx);
    if (r.inProgressAt) {
      if (meets(d1, r.inProgressAt)) ok++;
    } else if (r.status === 'CANCELLED' || r.status === 'RESOLVED') {
      if (meets(d1, r.resolvedAt)) ok++;
    } else {
      if (meets(d1, now)) ok++;
    }
    // Fase 2: IN_PROGRESS → RESOLVED (só conta se chegou a IN_PROGRESS)
    if (r.inProgressAt) {
      total++;
      const d2 = computeBusinessDeadline(r.inProgressAt, sla.toResolve, ctx);
      if (r.resolvedAt) {
        if (meets(d2, r.resolvedAt)) ok++;
      } else {
        if (meets(d2, now)) ok++;
      }
    }
  }
  return aderencia(ok, total);
}

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

  // Em todo acesso de ADM/SAYGO, dá uma "tocada" no monitor de storage —
  // garante que se o app rodar pouco a noite e o cron interno não pegar, ao
  // logar pela manhã ele já avisa.
  checkAndAlertIfNeeded().catch(() => {});

  // Contexto de SLA (expediente + feriados) — cacheado; usado nos 3 fluxos.
  const slaCtx = await getSlaContext();

  const [
    kanbanByStage, kanbanTotal,
    creditByStatus, creditTotal, creditOpen,
    desonByStatus,  desonTotal,  desonOpen,
    kanbanSla, desonSla, creditSla,
    storage,
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
    // Aderência SLA — uma promise pra cada fluxo (prazo em horário comercial)
    getKanbanSlaAderencia(prisma, hasDate, dateRange, slaCtx),
    getDesoneracaoSlaAderencia(prisma, hasDate, dateRange, slaCtx),
    getCreditoSlaAderencia(prisma, hasDate, dateRange, slaCtx),
    // Uso de storage (Neon free 500 MB)
    getStorageUsage(),
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
      sla: kanbanSla,
    },
    creditos: {
      total: creditTotal,
      emAberto: creditOpen,
      porStatus: creditByStatus.map(r => ({ status: r.status, count: r._count._all })),
      sla: creditSla,
    },
    desoneracoes: {
      total: desonTotal,
      emAberto: desonOpen,
      porStatus: desonByStatus.map(r => ({ status: r.status, count: r._count._all })),
      porEtapaEmAberto: desonOpenByStep.map(r => ({ step: r.currentStep, count: r._count._all })),
      sla: desonSla,
    },
    storage,
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
