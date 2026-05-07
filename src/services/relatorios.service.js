import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma } from '../config/prisma.js';
import { movimentacaoScope } from '../utils/scope.js';

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

export async function relatorioPdf(user, q, res) {
  const rows = await fetchRelatorioRows(user, q);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="relatorio-${Date.now()}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
  doc.pipe(res);
  doc.fontSize(14).text('Relatório de Movimentações — Conta Gráfica Saygo', { align: 'left' });
  doc.fontSize(9).fillColor('#888').text(new Date().toLocaleString('pt-BR'));
  doc.moveDown(0.5).fillColor('#000');
  // header
  const cols = ['Cliente','Escritório','Tipo','Data','DUIMP/DI','Parceiro','%','Valor','Ajustado'];
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text(cols.join(' | '));
  doc.font('Helvetica').moveDown(0.2);
  for (const m of rows) {
    const line = [
      m.cliente?.nome || '',
      m.cliente?.escritorio || '',
      m.tipoMovimento || '',
      m.dataNf ? m.dataNf.toISOString().slice(0,10) : '',
      m.duimpDiProcesso || '',
      m.parceiro || '',
      String(m.percentual ?? ''),
      Number(m.valor || 0).toFixed(2),
      Number(m.valorAjustado || 0).toFixed(2),
    ].join(' | ');
    doc.text(line);
  }
  doc.end();
}
