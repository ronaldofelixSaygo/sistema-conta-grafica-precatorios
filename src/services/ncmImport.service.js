// =====================================================================
// Import de CSV/XLSX para o módulo de NCM. Suporta 3 modos:
//
//   modo='tributos'  (default) — TIPI da Receita: ncm, descricao, IPI [, PIS, COFINS]
//   modo='tec'       — TEC Mercosul: ncm, II  (atualiza só o ii_aliq da ncm_tributos)
//   modo='anuentes'  — Tratamento Administrativo: ncm, anuente, descricao, obrigatorio
//
// Detecção automática de colunas pelo nome do header (case/acento-insensitive).
// =====================================================================
import * as XLSX from 'xlsx';
import { prisma } from '../config/prisma.js';

function fold(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
}

function cleanNcm(v) {
  return String(v||'').replace(/\D/g,'').slice(0, 8);
}

function parseAliq(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (!s || s === 'NT' || s === 'N/T' || s === '-') return 0;
  const n = parseFloat(s.replace('%','').replace(',','.').trim());
  return Number.isFinite(n) ? n : null;
}

function parseBool(v, defaultVal = true) {
  if (v == null || v === '') return defaultVal;
  const s = String(v).trim().toLowerCase();
  if (['1','true','sim','s','yes','y','obrig','obrigatorio'].includes(s)) return true;
  if (['0','false','nao','não','n','no','cond','condicional','opcional'].includes(s)) return false;
  return defaultVal;
}

// Detecção de colunas por modo
function detectColumns(headers, modo) {
  const map = {};
  for (let i = 0; i < headers.length; i++) {
    const h = fold(headers[i]);
    if (!h) continue;
    if (!('ncm' in map) && /^(ncm|codigo|cod|sh)$/.test(h)) map.ncm = i;
    if (!('descricao' in map) && /(descric|nomencla|produto|mercador)/.test(h)) map.descricao = i;
    if (!('ipi' in map) && /^(ipi|aliquotaipi|aliqipi)$/.test(h)) map.ipi = i;
    if (!('ii' in map)  && /(impimport|aliquotaii|^tec$|aliqii|^ii$|impostoimportac)/.test(h)) map.ii = i;
    if (!('pis' in map) && /^(pis|aliquotapis)$/.test(h)) map.pis = i;
    if (!('cofins' in map) && /^(cofins|aliquotacofins)$/.test(h)) map.cofins = i;
    if (!('anuente' in map) && /^(anuente|orgao|orgaoanuente|controle|controla|orgaocontrolador)$/.test(h)) map.anuente = i;
    if (!('obrigatorio' in map) && /(obrig|tipo|natureza)/.test(h)) map.obrigatorio = i;
  }
  // Fallback posicional
  if (modo === 'tributos') {
    if (!('ncm' in map) && headers.length) map.ncm = 0;
    if (!('descricao' in map) && headers.length > 1) map.descricao = 1;
    if (!('ipi' in map) && headers.length > 2) map.ipi = 2;
  } else if (modo === 'tec') {
    if (!('ncm' in map) && headers.length) map.ncm = 0;
    if (!('ii' in map) && headers.length > 1) map.ii = 1;
  } else if (modo === 'anuentes') {
    if (!('ncm' in map) && headers.length) map.ncm = 0;
    if (!('anuente' in map) && headers.length > 1) map.anuente = 1;
    if (!('descricao' in map) && headers.length > 2) map.descricao = 2;
    if (!('obrigatorio' in map) && headers.length > 3) map.obrigatorio = 3;
  }
  return map;
}

export async function importNcmFile({ buffer, filename, modo = 'tributos' }) {
  const ext = String(filename||'').toLowerCase().split('.').pop();
  if (!['csv', 'xlsx', 'xls', 'tsv'].includes(ext)) {
    const e = new Error(`Formato não suportado: .${ext} (use CSV ou XLSX)`); e.status = 400; throw e;
  }
  if (!['tributos','tec','anuentes'].includes(modo)) {
    const e = new Error(`Modo inválido: ${modo}`); e.status = 400; throw e;
  }

  const wb = XLSX.read(buffer, { type: 'buffer', codepage: 65001 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length < 2) { const e = new Error('Arquivo vazio'); e.status = 400; throw e; }

  // Tenta achar a linha do header nas primeiras 8 linhas
  let headerRowIdx = 0;
  let cols = detectColumns(rows[0].map(String), modo);
  if (typeof cols.ncm !== 'number' || !cleanNcm(rows[1]?.[cols.ncm])) {
    for (let i = 1; i < Math.min(8, rows.length); i++) {
      const tryCols = detectColumns(rows[i].map(String), modo);
      if (typeof tryCols.ncm === 'number' && cleanNcm(rows[i+1]?.[tryCols.ncm])?.length >= 2) {
        cols = tryCols; headerRowIdx = i; break;
      }
    }
  }

  const stats = { modo, totalLinhas: rows.length, headerRow: headerRowIdx, mapeamento: cols, importados: 0, atualizados: 0, ignorados: 0, erros: [] };

  if (modo === 'anuentes') {
    // Limpa anuentes antigos (substituição completa) e re-popula
    await prisma.ncmAnuente.deleteMany({});
    const lote = [];
    const BATCH = 500;
    const flushAnu = async () => {
      if (!lote.length) return;
      try {
        const r = await prisma.ncmAnuente.createMany({ data: lote, skipDuplicates: true });
        stats.importados += r.count;
      } catch (e) {
        if (stats.erros.length < 20) stats.erros.push(e.message);
      }
      lote.length = 0;
    };
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const ncm = cleanNcm(r[cols.ncm]);
      const anuente = String(r[cols.anuente] || '').trim().toUpperCase();
      if (!ncm || ncm.length < 2 || !anuente) { stats.ignorados++; continue; }
      lote.push({
        ncm,
        anuente: anuente.slice(0, 80),
        descricao: cols.descricao != null ? String(r[cols.descricao] || '').trim().slice(0, 500) : null,
        obrigatorio: cols.obrigatorio != null ? parseBool(r[cols.obrigatorio], true) : true,
      });
      if (lote.length >= BATCH) await flushAnu();
    }
    await flushAnu();
    return stats;
  }

  // tributos | tec → atualiza ncm_tributos
  const lote = [];
  const BATCH = 200;
  const flushTrib = async () => {
    if (!lote.length) return;
    if (modo === 'tributos') {
      try {
        const r = await prisma.ncmTributo.createMany({ data: lote, skipDuplicates: true });
        stats.importados += r.count;
        if (r.count < lote.length) {
          for (const d of lote) {
            try { await prisma.ncmTributo.update({ where: { ncm: d.ncm }, data: d }); stats.atualizados++; }
            catch {}
          }
        }
      } catch (e) {
        if (stats.erros.length < 10) stats.erros.push(e.message);
        for (const d of lote) {
          try { await prisma.ncmTributo.upsert({ where: { ncm: d.ncm }, create: d, update: d }); stats.importados++; }
          catch (er) { if (stats.erros.length < 20) stats.erros.push(`${d.ncm}: ${er.message}`); }
        }
      }
    } else {
      // modo TEC → atualiza só ii_aliq (preserva descrição/IPI/PIS/COFINS existentes)
      for (const d of lote) {
        try {
          await prisma.ncmTributo.upsert({
            where: { ncm: d.ncm },
            create: { ncm: d.ncm, descricao: '', ii_aliq: d.ii_aliq, ipi_aliq: 0, pis_aliq: 2.1, cofins_aliq: 9.65 },
            update: { ii_aliq: d.ii_aliq },
          });
          stats.atualizados++;
        } catch (er) { if (stats.erros.length < 20) stats.erros.push(`${d.ncm}: ${er.message}`); }
      }
    }
    lote.length = 0;
  };

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const ncm = cleanNcm(r[cols.ncm]);
    if (!ncm || ncm.length < 4) { stats.ignorados++; continue; }
    if (modo === 'tributos') {
      lote.push({
        ncm,
        descricao: cols.descricao != null ? String(r[cols.descricao] || '').trim().slice(0, 500) : '',
        ii_aliq: cols.ii != null ? (parseAliq(r[cols.ii]) ?? 0) : 0,
        ipi_aliq: cols.ipi != null ? (parseAliq(r[cols.ipi]) ?? 0) : 0,
        pis_aliq: cols.pis != null ? (parseAliq(r[cols.pis]) ?? 2.1) : 2.1,
        cofins_aliq: cols.cofins != null ? (parseAliq(r[cols.cofins]) ?? 9.65) : 9.65,
      });
    } else {
      // tec
      const ii = cols.ii != null ? parseAliq(r[cols.ii]) : null;
      if (ii == null) { stats.ignorados++; continue; }
      lote.push({ ncm, ii_aliq: ii });
    }
    if (lote.length >= BATCH) await flushTrib();
  }
  await flushTrib();
  return stats;
}
