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

// Detecção de colunas pelos nomes dos headers (com fold de acentos/case).
// NÃO inclui fallback posicional aqui — o caller decide se aplica.
// Retorna o map + namedScore (quantos campos foram casados por nome).
function detectColumnsByName(headers, modo) {
  const map = {};
  let namedScore = 0;
  function set(key, idx) { if (!(key in map)) { map[key] = idx; namedScore++; } }
  for (let i = 0; i < headers.length; i++) {
    const h = fold(headers[i]);
    if (!h) continue;
    if (/^(ncm|codigo|cod|sh)$/.test(h)) set('ncm', i);
    if (/(descric|nomencla|produto|mercador)/.test(h)) set('descricao', i);
    // 'aliquota' isolado vira IPI no modo tributos (header padrão da TIPI é "ALÍQUOTA (%)")
    if (/^(ipi|aliquotaipi|aliqipi)$/.test(h)) set('ipi', i);
    else if (modo === 'tributos' && /^aliquota$/.test(h)) set('ipi', i);
    // II vem com vários rótulos na prática: "TEC (%)", "Alíquota aplicada (%)",
    // "Alíquota (%)", "II", "Imposto de Importação", etc. Quando o modo é 'tec',
    // priorizamos "Alíquota aplicada" se aparecer — match silencioso é melhor
    // que falha; pra TEC oficial use scripts/parse-tec.mjs antes de subir.
    if (modo === 'tec' && /^aliquotaaplicada(pct|porcent)?$|^aliquotaaplicada$/.test(h)) set('ii', i);
    else if (/(impimport|aliquotaii|^tec$|aliqii|iialiq|^ii$|impostoimportac|^aliquotaaplicada$|^aliquota$)/.test(h)) set('ii', i);
    if (/^(pis|aliquotapis)$/.test(h)) set('pis', i);
    if (/^(cofins|aliquotacofins)$/.test(h)) set('cofins', i);
    if (/^(anuente|orgao|orgaoanuente|controle|controla|orgaocontrolador)$/.test(h)) set('anuente', i);
    if (/(obrig|tipo|natureza)/.test(h)) set('obrigatorio', i);
  }
  map._namedScore = namedScore;
  return map;
}

// Fallback posicional — só usado se nenhum header foi achado pelo nome.
function positionalColumns(headersLen, modo) {
  const map = { _namedScore: 0 };
  if (modo === 'tributos') {
    if (headersLen >= 1) map.ncm = 0;
    if (headersLen >= 2) map.descricao = 1;
    if (headersLen >= 3) map.ipi = 2;
  } else if (modo === 'tec') {
    if (headersLen >= 1) map.ncm = 0;
    if (headersLen >= 2) map.ii = 1;
  } else if (modo === 'anuentes') {
    if (headersLen >= 1) map.ncm = 0;
    if (headersLen >= 2) map.anuente = 1;
    if (headersLen >= 3) map.descricao = 2;
    if (headersLen >= 4) map.obrigatorio = 3;
  }
  return map;
}

// Verdadeiro se o map tem o mínimo de campos requeridos pra cada modo.
function hasRequiredCols(map, modo) {
  if (typeof map.ncm !== 'number') return false;
  if (modo === 'tributos') return true; // ncm é o único obrigatório (descricao/ipi opcionais)
  if (modo === 'tec')      return typeof map.ii === 'number';
  if (modo === 'anuentes') return typeof map.anuente === 'number';
  return false;
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

  // Acha o header pela maior pontuação de matches nomeados nas primeiras 15
  // linhas (a TIPI da Receita tem 7 linhas de metadados antes do header real).
  // Só cai pro fallback posicional se NENHUM header nomeado for achado.
  let headerRowIdx = 0;
  let cols = null;
  let bestScore = 0;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const tryCols = detectColumnsByName(rows[i].map(String), modo);
    if (!hasRequiredCols(tryCols, modo)) continue;
    // Confere que a próxima linha (i+1) tem um NCM válido — evita pegar uma
    // linha de subtítulo que casualmente tenha a palavra "NCM".
    const nextNcm = cleanNcm(rows[i+1]?.[tryCols.ncm]);
    if (!nextNcm || nextNcm.length < 2) continue;
    if (tryCols._namedScore > bestScore) {
      bestScore = tryCols._namedScore;
      cols = tryCols;
      headerRowIdx = i;
    }
  }
  // Sem header nomeado em nenhuma das primeiras 15 linhas → cai pra posicional.
  if (!cols) {
    cols = positionalColumns(rows[0].length, modo);
    headerRowIdx = 0;
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
  const BATCH = 500;
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
      // modo TEC → atualiza só ii_aliq (preserva descrição/IPI/PIS/COFINS existentes).
      // UPSERT em lote via raw SQL: linha-a-linha estourava o timeout do proxy
      // (Neon ~80–150 ms × ~10k linhas = vários minutos).
      try {
        const placeholders = lote.map((_, i) => `($${i*2+1}, $${i*2+2}::float)`).join(',');
        const params = lote.flatMap(d => [d.ncm, d.ii_aliq]);
        await prisma.$executeRawUnsafe(
          `INSERT INTO ncm_tributos (ncm, descricao, ii_aliq, ipi_aliq, pis_aliq, cofins_aliq, "updatedAt", "createdAt")
           SELECT v.ncm, '', v.ii, 0, 2.1, 9.65, NOW(), NOW()
           FROM (VALUES ${placeholders}) AS v(ncm, ii)
           ON CONFLICT (ncm) DO UPDATE SET ii_aliq = EXCLUDED.ii_aliq, "updatedAt" = NOW()`,
          ...params
        );
        stats.atualizados += lote.length;
      } catch (er) {
        if (stats.erros.length < 10) stats.erros.push(`Lote TEC: ${er.message}`);
        // Fallback linha-a-linha caso o lote falhe
        for (const d of lote) {
          try {
            await prisma.ncmTributo.upsert({
              where: { ncm: d.ncm },
              create: { ncm: d.ncm, descricao: '', ii_aliq: d.ii_aliq, ipi_aliq: 0, pis_aliq: 2.1, cofins_aliq: 9.65 },
              update: { ii_aliq: d.ii_aliq },
            });
            stats.atualizados++;
          } catch (er2) { if (stats.erros.length < 20) stats.erros.push(`${d.ncm}: ${er2.message}`); }
        }
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
