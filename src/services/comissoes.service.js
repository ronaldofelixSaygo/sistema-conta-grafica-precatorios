import { prisma } from '../config/prisma.js';
import { clienteScope } from '../utils/scope.js';

// =====================================================================
// LISTA de "escritorios" únicos derivados dos cadastros de Cliente.
// É o que vai popular os dropdowns de Simulação e Apuração.
// =====================================================================
export async function listEscritorios(user) {
  const rows = await prisma.cliente.findMany({
    where: { AND: [clienteScope(user), { escritorio: { not: null } }] },
    select: { escritorio: true },
    distinct: ['escritorio'],
    orderBy: { escritorio: 'asc' },
  });
  return rows.map(r => r.escritorio).filter(Boolean);
}

// Garante que existe um Parceiro tipo ESCRITORIO com o nome informado.
// Necessário pra manter o vínculo Commission.parceiroId no schema.
async function ensureParceiroByEscritorio(nome) {
  const found = await prisma.parceiro.findFirst({ where: { nome } });
  if (found) return found;
  return prisma.parceiro.create({
    data: { nome, type: 'ESCRITORIO', active: true, isSaygo: false, stages: [] },
  });
}

// =====================================================================
// SIMULACAO de comissoes (calculo on-the-fly, sem persistir)
// Replica a regra do sistema antigo: periodo entre (dia_fechamento+1)
// do mes anterior e dia_fechamento do mes corrente.
// =====================================================================
export async function simulate(user, { escritorio, parceiro, parceiroId, mes, ano } = {}) {
  // Filtro principal agora é "escritorio" (string que aparece no cadastro do cliente)
  // Para PARTNER, sempre força o próprio escritório (officeName / parceiroNome)
  // Para STAFF/ADM, usa o que veio na query
  let escFiltro = null;
  if (user.role === 'PARTNER') {
    escFiltro = user.officeName || user.parceiroNome || null;
  } else if (escritorio) {
    escFiltro = escritorio;
  } else if (parceiroId) {
    // legacy: aceita parceiroId pra não quebrar callers antigos
    const p = await prisma.parceiro.findUnique({
      where: { id: parceiroId }, select: { nome: true },
    });
    escFiltro = p?.nome || null;
  } else if (parceiro) {
    escFiltro = parceiro;
  }

  // Clientes elegíveis: comissão % > 0 OU valorPorDi > 0 (qualquer um dos dois blocos)
  const where = {
    AND: [
      clienteScope(user),
      { OR: [{ percentualComissao: { gt: 0 } }, { valorPorDi: { gt: 0 } }] },
    ],
  };
  if (escFiltro) where.AND.push({ escritorio: escFiltro });

  const clientes = await prisma.cliente.findMany({
    where,
    select: {
      id: true, nome: true, escritorio: true,
      percentualComissao: true, diaFechamento: true, valorPorDi: true,
    },
  });
  if (clientes.length === 0) return [];

  const ids = clientes.map(c => c.id);
  // Créditos reconhecidos e cedidos — comissão %
  const movsCred = await prisma.movimentacao.findMany({
    where: { clienteId: { in: ids }, tipoMovimento: 'Créditos Reconhecidos e Cedidos' },
    select: { clienteId: true, dataNf: true, valorAjustado: true },
    orderBy: { dataNf: 'asc' },
  });
  // Débitos com DI/Duimp — valor por DI
  const movsDeb = await prisma.movimentacao.findMany({
    where: {
      clienteId: { in: ids },
      tipoMovimento: { startsWith: 'Débito' },
      duimpDiProcesso: { not: null },
    },
    select: { clienteId: true, dataNf: true, duimpDiProcesso: true },
    orderBy: { dataNf: 'asc' },
  });
  if (movsCred.length === 0 && movsDeb.length === 0) return [];

  // Range de datas combinado pra varrer os meses
  const allDates = [
    ...movsCred.map(m => m.dataNf),
    ...movsDeb.map(m => m.dataNf),
  ].filter(Boolean).sort((a,b)=>a-b);
  if (allDates.length === 0) return [];
  const minDate = allDates[0];
  const maxDate = allDates[allDates.length - 1];

  const acc = {};
  for (const cliente of clientes) {
    const dia = cliente.diaFechamento || 1;
    const pct = cliente.percentualComissao || 0;
    const vpd = cliente.valorPorDi || 0;
    const partner = cliente.escritorio || 'Sem Escritório';
    const msCred = movsCred.filter(m => m.clienteId === cliente.id);
    const msDeb  = movsDeb.filter(m => m.clienteId === cliente.id);
    if (msCred.length === 0 && msDeb.length === 0) continue;

    let cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const end = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
    while (cur <= end) {
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const ini = new Date(y, m - 1, dia + 1);
      const fim = new Date(y, m, dia, 23, 59, 59, 999);

      // Bloco 1: crédito × percentual
      const totalCred = pct > 0 ? msCred.reduce((s, x) => {
        if (!x.dataNf) return s;
        return (x.dataNf >= ini && x.dataNf <= fim) ? s + (x.valorAjustado || 0) : s;
      }, 0) : 0;
      const valorComissao = totalCred * (pct / 100);

      // Bloco 2: DIs únicas × valorPorDi (dedup por número de documento)
      let totalDis = 0;
      let valorComissaoDi = 0;
      if (vpd > 0 && msDeb.length) {
        const seenDis = new Set();
        for (const d of msDeb) {
          if (!d.dataNf || d.dataNf < ini || d.dataNf > fim) continue;
          const numero = String(d.duimpDiProcesso || '').trim();
          if (!numero) continue;
          if (seenDis.has(numero)) continue;
          seenDis.add(numero);
        }
        totalDis = seenDis.size;
        valorComissaoDi = totalDis * vpd;
      }

      const totalCliente = valorComissao + valorComissaoDi;
      if (totalCliente > 0) {
        const mesAno = `${String(m + 1).padStart(2, '0')}/${y}`;
        if (!escFiltro || partner === escFiltro) {
          const key = `${partner}|${mesAno}`;
          if (!acc[key]) acc[key] = {
            parceiro: partner, mes_ano: mesAno,
            total_comissao: 0,
            total_comissao_credito: 0,
            total_comissao_di: 0,
            detalhes: [],
          };
          acc[key].total_comissao += totalCliente;
          acc[key].total_comissao_credito += valorComissao;
          acc[key].total_comissao_di += valorComissaoDi;
          acc[key].detalhes.push({
            cliente_id: cliente.id, cliente_nome: cliente.nome,
            total_creditos: totalCred, percentual: pct, valor_comissao: valorComissao,
            total_dis: totalDis, valor_por_di: vpd, valor_comissao_di: valorComissaoDi,
            valor_total: totalCliente,
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

// Verifica se a comissão pertence ao escritório do usuário PARTNER
async function commissionPertenceAoUser(commission, user) {
  if (user.role !== 'PARTNER') return true; // STAFF/ADM têm acesso geral
  if (commission.parceiroId === user.parceiroId) return true;
  // pode ser um parceiro auto-criado com mesmo nome do escritório do user
  const parc = await prisma.parceiro.findUnique({
    where: { id: commission.parceiroId }, select: { nome: true },
  });
  const escUser = user.officeName || user.parceiroNome;
  return !!(parc && escUser && parc.nome === escUser);
}

// Lista de comissoes persistidas. Saygo/Adm vê todas, Parceiro só as do seu escritório.
export async function listCommissions(user) {
  const where = {};
  if (user.role === 'PARTNER') {
    const escritorioName = user.officeName || user.parceiroNome;
    if (!escritorioName) return [];
    // pega todos os parceiros que tenham aquele nome (caso tenham sido auto-criados)
    const parcs = await prisma.parceiro.findMany({
      where: { nome: escritorioName }, select: { id: true },
    });
    const ids = parcs.map(p => p.id);
    if (user.parceiroId && !ids.includes(user.parceiroId)) ids.push(user.parceiroId);
    where.parceiroId = { in: ids.length ? ids : ['__none__'] };
  }
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

// Gera (cria/atualiza) a apuracao para o mes-ref e escritorio.
// SOMENTE PARTNER ESCRITORIO pode gerar. Saygo/Adm apenas visualiza/aprova.
export async function generateCommission(user, { monthRef } = {}) {
  if (!(user.role === 'PARTNER' && user.partnerType === 'ESCRITORIO')) {
    const e = new Error('Apenas parceiros do tipo Escritório podem gerar apuração'); e.status = 403; throw e;
  }
  const escritorioName = user.officeName || user.parceiroNome;
  if (!escritorioName) { const e = new Error('Usuário sem escritório definido'); e.status = 400; throw e; }

  if (!monthRef || !/^\d{4}-\d{2}$/.test(monthRef)) {
    const e = new Error('monthRef inválido (use YYYY-MM)'); e.status = 400; throw e;
  }

  // garante que existe um Parceiro com esse nome (pra manter o FK no schema)
  const parc = await ensureParceiroByEscritorio(escritorioName);
  const parceiroId = parc.id;

  const clientes = await prisma.cliente.findMany({
    where: {
      escritorio: escritorioName,
      OR: [{ percentualComissao: { gt: 0 } }, { valorPorDi: { gt: 0 } }],
    },
    select: { id: true, nome: true, percentualComissao: true, diaFechamento: true, valorPorDi: true },
  });
  const [yy, mm] = monthRef.split('-').map(Number);
  const ids = clientes.map(c => c.id);
  const [movsCred, movsDeb] = await Promise.all([
    prisma.movimentacao.findMany({
      where: { clienteId: { in: ids }, tipoMovimento: 'Créditos Reconhecidos e Cedidos' },
      select: { clienteId: true, dataNf: true, valorAjustado: true },
    }),
    prisma.movimentacao.findMany({
      where: {
        clienteId: { in: ids },
        tipoMovimento: { startsWith: 'Débito' },
        duimpDiProcesso: { not: null },
      },
      select: { clienteId: true, dataNf: true, duimpDiProcesso: true },
    }),
  ]);

  const detalhes = [];
  let totalBaseCredito = 0;
  let totalBaseDi = 0;
  for (const c of clientes) {
    const dia = c.diaFechamento || 1;
    const pct = c.percentualComissao || 0;
    const vpd = c.valorPorDi || 0;
    const ini = new Date(yy, mm - 2, dia + 1);
    const fim = new Date(yy, mm - 1, dia, 23, 59, 59, 999);

    // Bloco 1: créditos × %
    const totalCred = pct > 0
      ? movsCred.filter(m => m.clienteId === c.id && m.dataNf && m.dataNf >= ini && m.dataNf <= fim)
                .reduce((s,x) => s + (x.valorAjustado || 0), 0)
      : 0;
    const valorComissao = totalCred * (pct / 100);

    // Bloco 2: DIs únicas × valorPorDi
    let totalDis = 0;
    let valorComissaoDi = 0;
    if (vpd > 0) {
      const seen = new Set();
      for (const d of movsDeb) {
        if (d.clienteId !== c.id) continue;
        if (!d.dataNf || d.dataNf < ini || d.dataNf > fim) continue;
        const numero = String(d.duimpDiProcesso || '').trim();
        if (!numero || seen.has(numero)) continue;
        seen.add(numero);
      }
      totalDis = seen.size;
      valorComissaoDi = totalDis * vpd;
    }

    const valor = valorComissao + valorComissaoDi;
    if (valor > 0) {
      detalhes.push({
        cliente_id: c.id, cliente_nome: c.nome,
        total_creditos: totalCred, percentual: pct, valor_comissao: valorComissao,
        total_dis: totalDis, valor_por_di: vpd, valor_comissao_di: valorComissaoDi,
        valor_total: valor,
        periodo_inicio: ini.toISOString().slice(0,10),
        periodo_fim:    fim.toISOString().slice(0,10),
      });
      totalBaseCredito += valorComissao;
      totalBaseDi += valorComissaoDi;
    }
  }
  const totalBase = totalBaseCredito + totalBaseDi;

  // upsert (cria ou atualiza enquanto nao fechada)
  // Considera TODOS os Parceiros com mesmo nome — evita duplicar se o nome bater
  const parcsMesmoNome = await prisma.parceiro.findMany({
    where: { nome: escritorioName }, select: { id: true },
  });
  const parcIds = parcsMesmoNome.map(p => p.id);
  const existing = await prisma.commission.findFirst({
    where: { parceiroId: { in: parcIds }, monthRef },
    include: { extras: true },
  });
  if (existing && existing.status === 'CLOSED') {
    const e = new Error('Comissão já fechada — não pode ser reprocessada'); e.status = 409; throw e;
  }
  if (existing && existing.status === 'APPROVED') {
    const e = new Error('Comissão já aprovada — não pode ser reprocessada'); e.status = 409; throw e;
  }
  if (existing && existing.status === 'SUBMITTED') {
    const e = new Error('Comissão já enviada para revisão. Cancele e refaça se quiser recalcular.'); e.status = 409; throw e;
  }
  const totalExtras = (existing?.extras || []).reduce((s, x) => s + Number(x.amount || 0), 0);
  const totalFinal = totalBase + totalExtras;

  if (existing) {
    return prisma.commission.update({
      where: { id: existing.id },
      data: {
        totalBase, totalBaseCredito, totalBaseDi, totalExtras, totalFinal,
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
      totalBase, totalBaseCredito, totalBaseDi,
      totalExtras: 0, totalFinal: totalBase,
      detalhes,
      createdById: user.id,
      status: 'DRAFT',
    },
    include: { extras: true, parceiro: { select: { nome: true } } },
  });
}

// Excluir apuração (apenas owner enquanto DRAFT/REJECTED)
export async function deleteCommission(user, id) {
  const c = await prisma.commission.findUnique({ where: { id } });
  if (!c) { const e = new Error('Comissão não encontrada'); e.status = 404; throw e; }
  if (!(await commissionPertenceAoUser(c, user))) {
    const e = new Error('Sem permissão'); e.status = 403; throw e;
  }
  if (!(c.status === 'DRAFT' || c.status === 'REJECTED')) {
    const e = new Error('Só pode excluir enquanto a apuração está em rascunho ou rejeitada'); e.status = 400; throw e;
  }
  await prisma.commission.delete({ where: { id } });
  return { ok: true };
}

// Submeter para revisão Saygo
export async function submitCommission(user, id) {
  const c = await prisma.commission.findUnique({ where: { id } });
  if (!c) { const e = new Error('Comissão não encontrada'); e.status = 404; throw e; }
  if (!(await commissionPertenceAoUser(c, user))) {
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
  if (!(await commissionPertenceAoUser(c, user))) {
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
  if (!(await commissionPertenceAoUser(c, user))) {
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
