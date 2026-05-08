import { prisma } from '../config/prisma.js';
import { clienteScope } from '../utils/scope.js';

// =====================================================================
// SIMULACAO de comissoes (calculo on-the-fly, sem persistir)
// Replica a regra do sistema antigo: periodo entre (dia_fechamento+1)
// do mes anterior e dia_fechamento do mes corrente.
// =====================================================================
export async function simulate(user, { parceiro, mes, ano } = {}) {
  const clientes = await prisma.cliente.findMany({
    where: { AND: [clienteScope(user), { percentualComissao: { gt: 0 } }] },
    select: {
      id: true, nome: true, escritorio: true,
      percentualComissao: true, diaFechamento: true,
    },
  });
  if (clientes.length === 0) return [];

  const ids = clientes.map(c => c.id);
  const movs = await prisma.movimentacao.findMany({
    where: { clienteId: { in: ids }, tipoMovimento: 'Créditos Reconhecidos e Cedidos' },
    select: { clienteId: true, dataNf: true, valorAjustado: true },
    orderBy: { dataNf: 'asc' },
  });
  if (movs.length === 0) return [];

  const movDates = movs.map(m => m.dataNf).filter(Boolean).sort((a,b)=>a-b);
  const minDate = movDates[0];
  const maxDate = movDates[movDates.length - 1];
  if (!minDate || !maxDate) return [];

  const acc = {};
  for (const cliente of clientes) {
    const dia = cliente.diaFechamento || 1;
    const pct = cliente.percentualComissao || 0;
    if (pct <= 0) continue;
    const partner = cliente.escritorio || 'Sem Escritório';
    const ms = movs.filter(m => m.clienteId === cliente.id);
    if (ms.length === 0) continue;

    let cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const end = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
    while (cur <= end) {
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const ini = new Date(y, m - 1, dia + 1);
      const fim = new Date(y, m, dia, 23, 59, 59, 999);
      const totalCred = ms.reduce((s, x) => {
        if (!x.dataNf) return s;
        return (x.dataNf >= ini && x.dataNf <= fim) ? s + (x.valorAjustado || 0) : s;
      }, 0);
      if (totalCred > 0) {
        const valorComissao = totalCred * (pct / 100);
        const mesAno = `${String(m + 1).padStart(2, '0')}/${y}`;
        if (!parceiro || partner === parceiro) {
          const key = `${partner}|${mesAno}`;
          if (!acc[key]) acc[key] = {
            parceiro: partner, mes_ano: mesAno, total_comissao: 0, detalhes: [],
          };
          acc[key].total_comissao += valorComissao;
          acc[key].detalhes.push({
            cliente_id: cliente.id, cliente_nome: cliente.nome,
            total_creditos: totalCred, percentual: pct, valor_comissao: valorComissao,
            periodo_inicio: ini.toISOString().slice(0,10),
            periodo_fim:    fim.toISOString().slice(0,10),
          });
        }
      }
      cur.setMonth(cur.getMonth() + 1);
    }
  }
  let result = Object.values(acc).sort((a, b) => {
    const [mA, yA] = a.mes_ano.split('/');
    const [mB, yB] = b.mes_ano.split('/');
    return (yB + mB).localeCompare(yA + mA) || a.parceiro.localeCompare(b.parceiro);
  });
  if (mes || ano) {
    result = result.filter(r => {
      const [m, y] = r.mes_ano.split('/');
      if (mes && ano) return m === mes && y === ano;
      if (mes) return m === mes;
      if (ano) return y === ano;
      return true;
    });
  }
  return result;
}

// =====================================================================
// COMISSOES PERSISTIDAS (parceiros escritorio geram apuracao real)
// =====================================================================

// Helper: retorna o parceiroId/nome do usuario PARTNER do tipo ESCRITORIO
function ensurePartnerEscritorio(user) {
  if (!(user.role === 'PARTNER' && user.partnerType === 'ESCRITORIO')) {
    const e = new Error('Apenas parceiros do tipo Escritório podem gerar apuração'); e.status = 403; throw e;
  }
  if (!user.parceiroId) { const e = new Error('Usuário sem parceiro vinculado'); e.status = 400; throw e; }
  return user.parceiroId;
}

// Lista de comissoes persistidas. Saygo/Adm vê todas, Parceiro só as suas.
export async function listCommissions(user) {
  const where = {};
  if (user.role === 'PARTNER') where.parceiroId = user.parceiroId || '__none__';
  return prisma.commission.findMany({
    where,
    include: {
      parceiro:    { select: { id: true, nome: true, type: true } },
      createdBy:   { select: { id: true, name: true } },
      reviewedBy:  { select: { id: true, name: true } },
      extras:      true,
    },
    orderBy: [{ monthRef: 'desc' }, { createdAt: 'desc' }],
  });
}

// Gera (cria/atualiza) a apuracao para o mes-ref e parceiro do user logado.
// Calcula o total_base com base nos clientes deste escritorio.
export async function generateCommission(user, { monthRef }) {
  const parceiroId = ensurePartnerEscritorio(user);
  if (!monthRef || !/^\d{4}-\d{2}$/.test(monthRef)) {
    const e = new Error('monthRef inválido (use YYYY-MM)'); e.status = 400; throw e;
  }

  // pega clientes vinculados ao escritório do parceiro
  const parc = await prisma.parceiro.findUnique({ where: { id: parceiroId } });
  const clientes = await prisma.cliente.findMany({
    where: { escritorio: parc?.nome || '__none__', percentualComissao: { gt: 0 } },
    select: { id: true, nome: true, percentualComissao: true, diaFechamento: true },
  });
  const [yy, mm] = monthRef.split('-').map(Number);
  const movs = await prisma.movimentacao.findMany({
    where: {
      clienteId: { in: clientes.map(c => c.id) },
      tipoMovimento: 'Créditos Reconhecidos e Cedidos',
    },
    select: { clienteId: true, dataNf: true, valorAjustado: true },
  });

  const detalhes = [];
  let totalBase = 0;
  for (const c of clientes) {
    const dia = c.diaFechamento || 1;
    const pct = c.percentualComissao || 0;
    if (pct <= 0) continue;
    const ini = new Date(yy, mm - 2, dia + 1);
    const fim = new Date(yy, mm - 1, dia, 23, 59, 59, 999);
    const totalCred = movs.filter(m => m.clienteId === c.id && m.dataNf && m.dataNf >= ini && m.dataNf <= fim)
                          .reduce((s,x) => s + (x.valorAjustado || 0), 0);
    if (totalCred > 0) {
      const valor = totalCred * (pct / 100);
      detalhes.push({
        cliente_id: c.id, cliente_nome: c.nome,
        total_creditos: totalCred, percentual: pct, valor_comissao: valor,
        periodo_inicio: ini.toISOString().slice(0,10),
        periodo_fim:    fim.toISOString().slice(0,10),
      });
      totalBase += valor;
    }
  }

  // upsert (cria ou atualiza enquanto nao fechada)
  const existing = await prisma.commission.findUnique({
    where: { parceiroId_monthRef: { parceiroId, monthRef } },
    include: { extras: true },
  });
  if (existing && existing.status === 'CLOSED') {
    const e = new Error('Comissão já fechada — não pode ser reprocessada'); e.status = 409; throw e;
  }
  const totalExtras = (existing?.extras || []).reduce((s, x) => s + Number(x.amount || 0), 0);
  const totalFinal = totalBase + totalExtras;

  if (existing) {
    return prisma.commission.update({
      where: { id: existing.id },
      data: {
        totalBase, totalExtras, totalFinal,
        detalhes,
        // Volta para DRAFT se estava REJECTED
        status: existing.status === 'REJECTED' ? 'DRAFT' : existing.status,
        rejectReason: existing.status === 'REJECTED' ? null : existing.rejectReason,
      },
      include: { extras: true, parceiro: { select: { nome: true } } },
    });
  }
  return prisma.commission.create({
    data: {
      parceiroId, monthRef,
      totalBase, totalExtras: 0, totalFinal: totalBase,
      detalhes,
      createdById: user.id,
      status: 'DRAFT',
    },
    include: { extras: true, parceiro: { select: { nome: true } } },
  });
}

// Submeter para revisão Saygo
export async function submitCommission(user, id) {
  const c = await prisma.commission.findUnique({ where: { id } });
  if (!c) { const e = new Error('Comissão não encontrada'); e.status = 404; throw e; }
  if (user.role === 'PARTNER' && c.parceiroId !== user.parceiroId) {
    const e = new Error('Sem permissão'); e.status = 403; throw e;
  }
  if (c.status === 'CLOSED' || c.status === 'APPROVED') {
    const e = new Error('Comissão não pode ser submetida nesse estado'); e.status = 400; throw e;
  }
  return prisma.commission.update({ where: { id }, data: { status: 'SUBMITTED', rejectReason: null } });
}

// Saygo/Adm aceita
export async function approveCommission(user, id) {
  if (!(user.role === 'ADM' || user.role === 'SAYGO')) {
    const e = new Error('Apenas Saygo aprova'); e.status = 403; throw e;
  }
  return prisma.commission.update({
    where: { id },
    data: { status: 'APPROVED', reviewedById: user.id, reviewedAt: new Date(), rejectReason: null },
  });
}

// Saygo/Adm rejeita (com motivo)
export async function rejectCommission(user, id, reason) {
  if (!(user.role === 'ADM' || user.role === 'SAYGO')) {
    const e = new Error('Apenas Saygo rejeita'); e.status = 403; throw e;
  }
  if (!reason) { const e = new Error('Informe o motivo da rejeição'); e.status = 400; throw e; }
  return prisma.commission.update({
    where: { id },
    data: { status: 'REJECTED', reviewedById: user.id, reviewedAt: new Date(), rejectReason: reason },
  });
}

// Fecha definitivamente (Saygo/Adm)
export async function closeCommission(user, id) {
  if (!(user.role === 'ADM' || user.role === 'SAYGO')) {
    const e = new Error('Apenas Saygo fecha'); e.status = 403; throw e;
  }
  return prisma.commission.update({
    where: { id }, data: { status: 'CLOSED', closedAt: new Date() },
  });
}

// === Lançamentos extras ===
export async function addExtra(user, commissionId, { description, amount }) {
  const c = await prisma.commission.findUnique({ where: { id: commissionId } });
  if (!c) { const e = new Error('Comissão não encontrada'); e.status = 404; throw e; }
  if (c.status === 'CLOSED' || c.status === 'APPROVED') {
    const e = new Error('Não pode adicionar extras nesse estado'); e.status = 400; throw e;
  }
  if (user.role === 'PARTNER' && c.parceiroId !== user.parceiroId) {
    const e = new Error('Sem permissão'); e.status = 403; throw e;
  }
  if (!description) { const e = new Error('Descrição obrigatória'); e.status = 400; throw e; }
  const ext = await prisma.commissionExtra.create({
    data: { commissionId, description, amount: Number(amount) || 0 },
  });
  await recompute(commissionId);
  return ext;
}
export async function removeExtra(user, extraId) {
  const ext = await prisma.commissionExtra.findUnique({ where: { id: extraId } });
  if (!ext) { const e = new Error('Não encontrado'); e.status = 404; throw e; }
  const c = await prisma.commission.findUnique({ where: { id: ext.commissionId } });
  if (c.status === 'CLOSED') { const e = new Error('Comissão fechada'); e.status = 400; throw e; }
  if (user.role === 'PARTNER' && c.parceiroId !== user.parceiroId) {
    const e = new Error('Sem permissão'); e.status = 403; throw e;
  }
  await prisma.commissionExtra.delete({ where: { id: extraId } });
  await recompute(ext.commissionId);
  return { ok: true };
}
async function recompute(id) {
  const c = await prisma.commission.findUnique({ where: { id }, include: { extras: true } });
  const totalExtras = (c.extras || []).reduce((s, x) => s + Number(x.amount || 0), 0);
  await prisma.commission.update({
    where: { id }, data: { totalExtras, totalFinal: c.totalBase + totalExtras },
  });
}
