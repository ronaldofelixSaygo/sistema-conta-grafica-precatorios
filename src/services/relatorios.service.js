import ExcelJS from 'exceljs';
import { prisma } from '../config/prisma.js';
import { movimentacaoScope } from '../utils/scope.js';

const fmtMoney = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate  = d => d ? new Date(d).toLocaleDateString('pt-BR') : '';
const escHtml  = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));

function buildWhere(user, q = {}) {
  const AND = [movimentacaoScope(user)];
  if (q.cliente_id) AND.push({ clienteId: Number(q.cliente_id) });
  if (q.f_tipo)     AND.push({ tipoMovimento: { contains: q.f_tipo, mode: 'insensitive' } });
  if (q.f_parceiro) AND.push({ parceiro: { contains: q.f_parceiro, mode: 'insensitive' } });
  if (q.f_data_ini) AND.push({ dataNf: { gte: new Date(q.f_data_ini) } });
  if (q.f_data_fim) AND.push({ dataNf: { lte: new Date(q.f_data_fim) } });
  return { AND };
}

export async function fetchRelatorioRows(user, q) {
  return prisma.movimentacao.findMany({
    where: buildWhere(user, q),
    orderBy: [{ dataNf: 'desc' }, { id: 'desc' }],
    include: { cliente: { select: { nome: true, escritorio: true } } },
  });
}

export async function relatorioJson(user, q) {
  const rows = await fetchRelatorioRows(user, q);
  return rows.map(m => ({
    cliente_nome: m.cliente?.nome,
    escritorio:   m.cliente?.escritorio,
    tipo_movimento: m.tipoMovimento,
    data_nf: m.dataNf,
    duimp_di_processo: m.duimpDiProcesso,
    parceiro: m.parceiro,
    percentual: m.percentual,
    valor: m.valor,
    valor_ajustado: m.valorAjustado,
  }));
}

export async function relatorioExcel(user, q, res) {
  const rows = await fetchRelatorioRows(user, q);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Movimentações');
  ws.columns = [
    { header: 'Cliente',          key: 'cliente',     width: 32 },
    { header: 'Escritório',       key: 'escritorio',  width: 22 },
    { header: 'Tipo',             key: 'tipo',        width: 30 },
    { header: 'Data NF',          key: 'data',        width: 12 },
    { header: 'DUIMP/DI/Processo',key: 'duimp',       width: 22 },
    { header: 'Parceiro',         key: 'parceiro',    width: 18 },
    { header: '%',                key: 'percentual',  width: 8  },
    { header: 'Valor',            key: 'valor',       width: 14 },
    { header: 'Valor ajustado',   key: 'ajustado',    width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const m of rows) {
    ws.addRow({
      cliente: m.cliente?.nome,
      escritorio: m.cliente?.escritorio,
      tipo: m.tipoMovimento,
      data: m.dataNf ? m.dataNf.toISOString().slice(0,10) : '',
      duimp: m.duimpDiProcesso,
      parceiro: m.parceiro,
      percentual: m.percentual,
      valor: m.valor,
      ajustado: m.valorAjustado,
    });
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="relatorio-${Date.now()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

// Gera o "PDF" como página HTML printable (estilo Vision do projeto antigo).
// O usuário clica em "Imprimir / Salvar PDF" no topo da página para gerar o PDF
// via diálogo do navegador — assim mantém a fidelidade visual.
export async function relatorioPdf(user, q, res) {
  const rows = await fetchRelatorioRows(user, q);

  // KPIs
  const creditos = rows.filter(r => r.valorAjustado > 0).reduce((s, r) => s + r.valorAjustado, 0);
  const debitos  = rows.filter(r => r.valorAjustado < 0).reduce((s, r) => s + r.valorAjustado, 0);
  const saldo    = creditos + debitos;

  // Saldo ACUMULADO: soma de TODO o extrato do cliente (ignora o filtro de
  // período/tipo), respeitando apenas o escopo do usuário e o cliente filtrado.
  const accWhere = { AND: [movimentacaoScope(user)] };
  if (q.cliente_id) accWhere.AND.push({ clienteId: Number(q.cliente_id) });
  const accAgg = await prisma.movimentacao.aggregate({ where: accWhere, _sum: { valorAjustado: true } });
  const saldoAcumulado = accAgg._sum.valorAjustado || 0;

  // Header info
  let clienteLabel = 'Todos os clientes';
  if (q.cliente_id) {
    const c = await prisma.cliente.findUnique({ where: { id: Number(q.cliente_id) }, select: { nome: true } });
    if (c) clienteLabel = c.nome;
  }
  const periodoLabel = (q.f_data_ini || q.f_data_fim)
    ? `${q.f_data_ini ? fmtDate(q.f_data_ini) : '—'} a ${q.f_data_fim ? fmtDate(q.f_data_fim) : '—'}`
    : 'Todos os períodos';
  const dataEmissao = new Date().toLocaleDateString('pt-BR');

  const tbody = rows.map((m, i) => `
    <tr class="${i % 2 ? 'alt' : ''}">
      <td>${escHtml(m.cliente?.nome)}</td>
      <td>${escHtml(m.tipoMovimento)}</td>
      <td>${fmtDate(m.dataNf)}</td>
      <td>${escHtml(m.duimpDiProcesso)}</td>
      <td class="pct">${(m.percentual ?? 0)}%</td>
      <td class="num ${m.valorAjustado < 0 ? 'neg' : 'pos'}">${fmtMoney(m.valorAjustado)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Vision - Extrato de Conta Gráfica</title>
<style>
  :root { --orange:#f37422; --orange-soft:#fff1e6; --green:#16a34a; --red:#dc2626; --blue:#2563eb;
          --bd:#e5e7eb; --txt:#1f2937; --muted:#6b7280; }
  * { box-sizing:border-box }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color:var(--txt); margin:0; padding:24px 32px; background:#fafafa }
  .toolbar { display:flex; justify-content:center; margin-bottom:18px; }
  .btn-print { background:var(--orange); color:#fff; border:0; border-radius:6px; padding:10px 20px; font-size:14px; font-weight:600; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,.1); }
  .btn-print:hover { background:#e8651b }
  .header { text-align:center; padding-bottom:14px; border-bottom:3px solid var(--orange); margin-bottom:18px; }
  .header h1 { color:var(--orange); margin:0; font-size:22px; font-weight:700 }
  .header .sub { color:var(--muted); font-size:12px; margin-top:4px }
  .info { display:flex; justify-content:space-between; flex-wrap:wrap; gap:12px; padding:8px 12px; background:#f3f4f6; border-radius:6px; margin-bottom:16px; font-size:13px }
  .info b { color:var(--txt) }
  .info span { color:var(--muted) }
  .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:18px }
  .kpi { padding:14px; border-radius:8px; text-align:center }
  .kpi .lbl { font-size:11px; letter-spacing:.5px; text-transform:uppercase; font-weight:600; margin-bottom:4px }
  .kpi .val { font-size:20px; font-weight:700 }
  .kpi.cred { background:#dcfce7 } .kpi.cred .val { color:var(--green) } .kpi.cred .lbl { color:var(--green) }
  .kpi.deb  { background:#fee2e2 } .kpi.deb  .val { color:var(--red)   } .kpi.deb  .lbl { color:var(--red)   }
  .kpi.sld  { background:#dbeafe } .kpi.sld  .val { color:var(--blue)  } .kpi.sld  .lbl { color:var(--blue)  }
  .kpi.acc  { background:#ede9fe } .kpi.acc  .val { color:#6d28d9 }      .kpi.acc  .lbl { color:#6d28d9 }
  table { width:100%; border-collapse:collapse; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.05); border-radius:6px; overflow:hidden }
  thead th { background:var(--orange); color:#fff; padding:10px 12px; text-align:left; font-size:12px; letter-spacing:.5px; text-transform:uppercase }
  tbody td { padding:8px 12px; border-bottom:1px solid var(--bd); font-size:13px }
  tbody tr.alt td { background:#fafafa }
  tbody td.num { text-align:right; font-variant-numeric:tabular-nums; font-weight:600 }
  tbody td.pct { text-align:right; font-variant-numeric:tabular-nums; color:var(--muted) }
  tbody td.neg { color:var(--red) } tbody td.pos { color:var(--green) }
  .empty { text-align:center; color:var(--muted); padding:24px }
  @media print {
    body { background:#fff; padding:8px 12px; -webkit-print-color-adjust:exact; print-color-adjust:exact }
    .toolbar { display:none }
    table { box-shadow:none }
  }
</style>
</head>
<body>
  <div class="toolbar"><button class="btn-print" onclick="window.print()">Imprimir / Salvar PDF</button></div>
  <div class="header">
    <h1>Vision - Extrato de Conta Gráfica</h1>
    <div class="sub">Saygo Group · Sistema de Gestão de Créditos</div>
  </div>
  <div class="info">
    <div><b>Cliente:</b> <span>${escHtml(clienteLabel)}</span></div>
    <div><b>Período:</b> <span>${escHtml(periodoLabel)}</span></div>
    <div><b>Data emissão:</b> <span>${escHtml(dataEmissao)}</span></div>
  </div>
  <div class="kpis">
    <div class="kpi cred"><div class="lbl">Créditos</div><div class="val">${fmtMoney(creditos)}</div></div>
    <div class="kpi deb"><div class="lbl">Débitos</div><div class="val">${fmtMoney(debitos)}</div></div>
    <div class="kpi sld"><div class="lbl">Saldo do período</div><div class="val">${fmtMoney(saldo)}</div></div>
    <div class="kpi acc"><div class="lbl">Saldo acumulado</div><div class="val">${fmtMoney(saldoAcumulado)}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Cliente</th>
        <th>Tipo Movimento</th>
        <th>Data NF</th>
        <th>DUIMP/DI</th>
        <th style="text-align:right">%</th>
        <th style="text-align:right">Valor</th>
      </tr>
    </thead>
    <tbody>
      ${tbody || `<tr><td colspan="6" class="empty">Nenhum lançamento no filtro selecionado.</td></tr>`}
    </tbody>
  </table>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}
