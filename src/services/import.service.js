// Importação genérica de planilhas Excel (.xlsx) — clientes ou movimentações.
// Mantém compatibilidade com o sistema antigo. Apenas ADM/SAYGO podem importar.
import * as XLSX from 'xlsx';
import { prisma } from '../config/prisma.js';

function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') return row[k];
    const lower = Object.keys(row).find(x => x.toLowerCase() === k.toLowerCase());
    if (lower && row[lower] !== undefined && row[lower] !== '') return row[lower];
  }
  return null;
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  // Excel pode entregar número de série
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function calcAjustado(tipo, valor) {
  const v = Math.abs(Number(valor) || 0);
  if (!tipo) return 0;
  if (String(tipo).includes('Débito')) return -v;
  if (String(tipo).includes('Crédito')) return v;
  return 0;
}

export async function importExcel(buffer, { kind = 'auto' } = {}) {
  const wb = XLSX.read(buffer, { cellDates: true });
  const summary = { clientes: 0, movimentacoes: 0, ignorados: 0, erros: [] };

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) continue;

    const sample = rows[0];
    const looksLikeMov = ['cliente','tipo_movimento','tipo movimento','valor','duimp']
      .some(k => Object.keys(sample).some(c => c.toLowerCase().includes(k)));

    if (kind === 'clientes' || (kind === 'auto' && !looksLikeMov)) {
      for (const r of rows) {
        try {
          const nome = pick(r, 'nome', 'cliente');
          if (!nome) { summary.ignorados++; continue; }
          await prisma.cliente.create({
            data: {
              nome: String(nome).trim(),
              cnpj: pick(r,'cnpj') || null,
              cnpjFilial: pick(r,'cnpj_filial','cnpj filial') || null,
              escritorio: pick(r,'escritorio','escritório') || null,
              percentualComissao: Number(pick(r,'percentual_comissao','% comissão','comissao') || 0),
              diaFechamento: Number(pick(r,'dia_fechamento','fechamento') || 1),
              observacoes: pick(r,'observacoes','observações') || null,
            },
          });
          summary.clientes++;
        } catch (e) { summary.erros.push(e.message); }
      }
    } else {
      for (const r of rows) {
        try {
          const nomeCli = pick(r,'cliente','cliente_nome','nome cliente');
          if (!nomeCli) { summary.ignorados++; continue; }
          const cli = await prisma.cliente.findFirst({ where: { nome: String(nomeCli).trim() } });
          if (!cli) { summary.ignorados++; continue; }
          const tipo = pick(r,'tipo_movimento','tipo movimento','tipo') || '';
          const valor = Number(pick(r,'valor') || 0);
          await prisma.movimentacao.create({
            data: {
              clienteId: cli.id,
              tipoMovimento: tipo,
              dataNf:  parseDate(pick(r,'data_nf','data nf','data')),
              duimpDiProcesso: pick(r,'duimp_di_processo','duimp','di','processo'),
              parceiro: cli.escritorio || null,
              dataExoneracao: parseDate(pick(r,'data_exoneracao','exoneracao')),
              percentual: Number(pick(r,'percentual','%') || 0),
              valor,
              valorAjustado: calcAjustado(tipo, valor),
            },
          });
          summary.movimentacoes++;
        } catch (e) { summary.erros.push(e.message); }
      }
    }
  }
  return summary;
}
