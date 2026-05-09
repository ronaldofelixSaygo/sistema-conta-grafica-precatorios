// =====================================================================
// Importa CSV ou XLSX da TIPI/TEC e popula a tabela ncm_tributos.
//
// Formatos aceitos:
//   1) CSV simples: cabeçalho com colunas
//      ncm, descricao, ii_aliq, ipi_aliq, pis_aliq, cofins_aliq
//   2) TIPI oficial (XLSX da Receita): colunas A=NCM, B=Descrição, C=Alíquota IPI, D=Ex
//      II é tirado do TEC (se vier numa coluna paralela ou planilha separada)
//   3) Detecção automática: olha as primeiras linhas e tenta mapear colunas
//      por nomes comuns (ncm/codigo, ipi/aliq_ipi, ii/imp_imp, etc.)
// =====================================================================
import * as XLSX from 'xlsx';
import { prisma } from '../config/prisma.js';

// Tenta achar a coluna por nomes comuns (case-insensitive, sem acentos)
function fold(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
}
function detectColumns(headers) {
  const map = {};
  for (let i = 0; i < headers.length; i++) {
    const h = fold(headers[i]);
    if (!h) continue;
    // NCM / código
    if (!('ncm' in map) && /^(ncm|codigo|cod|sh)$/.test(h)) map.ncm = i;
    // Descrição
    if (!('descricao' in map) && /(descric|nomencla|produto|mercador)/.test(h)) map.descricao = i;
    // IPI
    if (!('ipi' in map) && /^(ipi|aliquotaipi|aliqipi)$/.test(h)) map.ipi = i;
    // II
    if (!('ii' in map) && /(impimport|aliquotaii|tec|aliqii|^ii$|impostoimportac)/.test(h)) map.ii = i;
    // PIS
    if (!('pis' in map) && /^(pis|aliquotapis)$/.test(h)) map.pis = i;
    // COFINS
    if (!('cofins' in map) && /^(cofins|aliquotacofins)$/.test(h)) map.cofins = i;
  }
  // Se nada bateu, assume posicional padrão TIPI (A=NCM, B=Descricao, C=Aliq IPI)
  if (!('ncm' in map) && headers.length > 0) map.ncm = 0;
  if (!('descricao' in map) && headers.length > 1) map.descricao = 1;
  if (!('ipi' in map) && headers.length > 2) map.ipi = 2;
  return map;
}

// Converte string de alíquota pra número. Aceita "15", "15%", "15,00", "NT", "0", null.
function parseAliq(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (!s || s === 'NT' || s === 'N/T' || s === '-') return null; // NT = não tributado
  const num = parseFloat(s.replace(/[%\s.]/g, '').replace(',', '.')) / (s.includes(',') || s.includes('.') ? 1 : (s.length > 2 ? 100 : 1));
  // Lógica simplificada: se já tem vírgula/ponto, usa direto; senão divide por 100 se for >100
  const cleaned = s.replace('%','').replace(',','.').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Limpa NCM: remove pontos, espaços, mantém só dígitos
function cleanNcm(v) {
  return String(v||'').replace(/\D/g,'').slice(0, 8);
}

export async function importNcmFile({ buffer, filename }) {
  const ext = String(filename||'').toLowerCase().split('.').pop();
  if (!['csv', 'xlsx', 'xls', 'tsv'].includes(ext)) {
    const e = new Error(`Formato não suportado: .${ext} (use CSV ou XLSX)`); e.status = 400; throw e;
  }

  // Lê o workbook (SheetJS aceita CSV e XLSX)
  const wb = XLSX.read(buffer, { type: 'buffer', codepage: 65001 });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length < 2) {
    const e = new Error('Arquivo vazio ou sem dados'); e.status = 400; throw e;
  }

  // Detecta coluna pelo cabeçalho — pode estar nas primeiras 5 linhas (TIPI tem header complexo)
  let headerRowIdx = 0;
  let cols = detectColumns(rows[0].map(String));
  // Se não achou NCM em col 0 ou ele não é numérico, tenta linhas 1-4
  if (typeof cols.ncm !== 'number' || !cleanNcm(rows[1]?.[cols.ncm])) {
    for (let i = 1; i < Math.min(5, rows.length); i++) {
      const tryCols = detectColumns(rows[i].map(String));
      if (typeof tryCols.ncm === 'number' && cleanNcm(rows[i+1]?.[tryCols.ncm])?.length >= 2) {
        cols = tryCols;
        headerRowIdx = i;
        break;
      }
    }
  }

  const stats = { totalLinhas: rows.length, headerRow: headerRowIdx, mapeamento: cols, importados: 0, ignorados: 0, erros: [] };
  const lote = [];
  const BATCH = 200;

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const ncm = cleanNcm(r[cols.ncm]);
    if (!ncm || ncm.length < 4) { stats.ignorados++; continue; } // ignora linhas sem NCM válido (ex.: linhas de capítulo)
    const data = {
      ncm,
      descricao: cols.descricao != null ? String(r[cols.descricao] || '').trim().slice(0, 500) : '',
      ii_aliq: cols.ii != null ? (parseAliq(r[cols.ii]) ?? 0) : 0,
      ipi_aliq: cols.ipi != null ? (parseAliq(r[cols.ipi]) ?? 0) : 0,
      pis_aliq: cols.pis != null ? (parseAliq(r[cols.pis]) ?? 2.1) : 2.1,
      cofins_aliq: cols.cofins != null ? (parseAliq(r[cols.cofins]) ?? 9.65) : 9.65,
    };
    lote.push(data);

    if (lote.length >= BATCH) {
      await flush(lote, stats);
      lote.length = 0;
    }
  }
  if (lote.length) await flush(lote, stats);

  return stats;
}

async function flush(lote, stats) {
  // Usa createMany com skipDuplicates pra inserir novos rapidamente
  try {
    const r = await prisma.ncmTributo.createMany({ data: lote, skipDuplicates: true });
    stats.importados += r.count;
    // Pra os que já existiam (skipDuplicates pulou), faz update individual com as novas alíquotas
    if (r.count < lote.length) {
      for (const d of lote) {
        try {
          await prisma.ncmTributo.update({ where: { ncm: d.ncm }, data: d });
        } catch {}
      }
    }
  } catch (e) {
    if (stats.erros.length < 10) stats.erros.push(e.message);
    // Fallback linha-a-linha com upsert
    for (const d of lote) {
      try {
        await prisma.ncmTributo.upsert({
          where: { ncm: d.ncm },
          create: d,
          update: d,
        });
        stats.importados++;
      } catch (er) {
        if (stats.erros.length < 20) stats.erros.push(`${d.ncm}: ${er.message}`);
      }
    }
  }
}
