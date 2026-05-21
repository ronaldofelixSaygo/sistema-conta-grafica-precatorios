// =====================================================================
// Importacao de Extrato PDF (formato detalhado).
//
// O PDF tem 3 secoes:
//   • Créditos Reconhecidos e Cedidos   → tipo = crédito
//   • Débitos de Transferências         → tipo = débito (transferência)
//   • Débitos de Liquidações            → tipo = débito (liquidação)
//
// Como a coluna de valor débito vem sem sinal, o parser rastreia a
// secao corrente em vez de classificar pelo sinal.
//
// ----- DEDUP TOLERANTE (vale pra qualquer cliente) -----
// Dois lançamentos são considerados duplicados quando TODOS coincidem:
//   - tipo_movimento iguais
//   - |valor| iguais (precisão de 1 centavo)
//   - data_nf dentro de ±3 dias
//   - DUIMP "fuzzy": iguais após normalização (so alfanuméricos, upper),
//     ou uma é prefixo da outra com até 2 caracteres extras no fim.
//     Isso cobre as variações que apareciam no extrato:
//       • "25BR0000171329"   vs  "25BR00001713290"   (digito extra)
//       • "26BR0000146451-"  vs  "26BR00001464516"   (hifen/sufixo)
//       • "2516299531"       vs  "2516299531.1"      (sufixo .N)
//
// Dedup roda em 2 momentos:
//   1) No preview, dentro do proprio PDF, eliminando linhas "fantasmas"
//      que o parser gera quando o layout do PDF tem 2 visualizacoes
//      por lançamento. Entre versões similares, mantemos a "melhor"
//      (% > 0 vence; depois DUIMP mais curta; depois data mais antiga).
//   2) No apply, contra os lançamentos ja existentes do cliente e
//      contra os ja criados nesse batch.
// =====================================================================
import { prisma } from '../config/prisma.js';

async function extractText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let lastY = null;
    let lineParts = [];
    for (const item of tc.items) {
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        text += lineParts.join(' ') + '\n';
        lineParts = [];
      }
      lineParts.push(item.str);
      lastY = y;
    }
    if (lineParts.length) text += lineParts.join(' ') + '\n';
  }
  return text;
}

function parseDate(str) {
  const m = String(str).match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseValor(str) {
  let s = String(str).trim().replace(/[\s\xa0]/g, '');
  let neg = false;
  if (s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'))) {
    neg = true; s = s.replace(/^[(-]|[)]$/g, '');
  }
  s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s); if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

function isoToDateBr(isoYmd) {
  if (!isoYmd) return null;
  return new Date(`${isoYmd}T12:00:00.000Z`);
}

const SECTION_HEADERS = [
  { tipo: 'Créditos Reconhecidos e Cedidos',
    regex: /Cr[eé]ditos\s+Reconhecidos\s+e\s+Cedidos/i },
  { tipo: 'Débitos de Transferências',
    regex: /D[eé]bitos\s+de\s+Transfer[eê]ncias/i },
  { tipo: 'Débitos de Liquidações',
    regex: /D[eé]bitos\s+de\s+Liquida[cç][oõ]es/i },
];

function detectSection(line) {
  for (const h of SECTION_HEADERS) if (h.regex.test(line)) return h.tipo;
  return null;
}

function isHeaderOrFooter(line) {
  return /per[ií]odo\s*:|gerado\s+em|p[áa]gina\s+\d+\s+de|saldo\s+total|^data\s+(n[º°o]\s+processo|duimp)/i
    .test(line);
}

// ───────── Dedup fuzzy ─────────

function normalizeDuimp(d) {
  if (d == null) return '';
  return String(d).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

// Retorna:
//   true   → DUIMPs claramente iguais (ou variação tolerada)
//   false  → DUIMPs claramente diferentes
//   null   → indeterminado (ambas vazias) — quem chama decide pela data
function duimpSimilar(a, b) {
  const na = normalizeDuimp(a);
  const nb = normalizeDuimp(b);
  if (!na && !nb) return null;
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Uma é prefixo da outra, com diferença pequena no fim (1-2 chars)
  const [s, l] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (s.length >= 8 && l.startsWith(s) && l.length - s.length <= 2) return true;
  return false;
}

function dateStr(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return '';
}

function daysBetween(a, b) {
  const sa = dateStr(a), sb = dateStr(b);
  if (!sa || !sb) return 999;
  const t = (s) => new Date(`${s}T00:00:00.000Z`).getTime();
  return Math.abs(t(sa) - t(sb)) / 86400000;
}

function valoresIguais(a, b) {
  const va = Math.abs(Number(a) || 0);
  const vb = Math.abs(Number(b) || 0);
  return Math.abs(va - vb) <= 0.005;
}

// a e b: { tipo, valor, data (yyyy-mm-dd), duimp }
function isSimilar(a, b) {
  if ((a.tipo || '') !== (b.tipo || '')) return false;
  if (!valoresIguais(a.valor, b.valor)) return false;
  const dd = daysBetween(a.data, b.data);
  if (dd > 3) return false;
  const ds = duimpSimilar(a.duimp, b.duimp);
  if (ds === null) return dd === 0; // sem DUIMP em ambos → exige mesmo dia
  return ds;
}

// "Qualidade" para escolher a melhor versão entre duplicatas:
//   1) prefere percentual > 0 (parece a linha original)
//   2) DUIMP mais curta (mais provável de ser o número real)
//   3) data mais antiga
function quality(it) {
  const pct = Number(it.percentual) || 0;
  const dlen = normalizeDuimp(it.duimp).length;
  const dataT = it.data ? new Date(`${it.data}T00:00:00.000Z`).getTime() : Number.MAX_SAFE_INTEGER;
  return [pct > 0 ? 1 : 0, -dlen, -dataT];
}
function pickBetter(a, b) {
  const qa = quality(a), qb = quality(b);
  for (let i = 0; i < qa.length; i++) {
    if (qa[i] > qb[i]) return a;
    if (qa[i] < qb[i]) return b;
  }
  return a;
}

// ───────── Parse ─────────

export async function previewExtrato(buffer) {
  const text = await extractText(buffer);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const raw = [];
  let currentTipo = 'Créditos Reconhecidos e Cedidos';

  for (const line of lines) {
    const sec = detectSection(line);
    if (sec) { currentTipo = sec; continue; }
    if (isHeaderOrFooter(line)) continue;

    const date = parseDate(line);
    if (!date) continue;

    const matches = [...line.matchAll(/-?\(?\d{1,3}(?:\.\d{3})*,\d{2}\)?/g)];
    if (matches.length === 0) continue;
    const valor = parseValor(matches[matches.length - 1][0]);
    if (valor == null) continue;
    if (Math.abs(valor) < 0.005) continue;

    const duimpMatch = line.match(/\b(\d{2}BR\d{8,12}|\d{10,15})\b/);
    const duimp = duimpMatch ? duimpMatch[1] : null;

    // Percentual: "4%", "4,00%", "0,00%", etc.
    const pctMatch = line.match(/\b(\d{1,2}(?:[,.]\d{1,2})?)\s*%/);
    const percentual = pctMatch ? (parseValor(pctMatch[1]) || 0) : 0;

    raw.push({
      data: date,
      duimp,
      tipo: currentTipo,
      valor: Math.abs(valor),
      percentual,
      _raw: line.slice(0, 200),
    });
  }

  // Dedup dentro do PDF
  const deduped = [];
  for (const it of raw) {
    const idx = deduped.findIndex(d => isSimilar(d, it));
    if (idx === -1) deduped.push(it);
    else deduped[idx] = pickBetter(deduped[idx], it);
  }

  // Saida no formato que a UI consome
  const items = deduped.map(it => ({
    data_nf: it.data,
    duimp_di_processo: it.duimp,
    tipo_movimento: it.tipo,
    valor: it.valor,
    percentual: it.percentual,
    _raw: it._raw,
  }));

  return { count: items.length, items };
}

// ───────── Apply ─────────

export async function applyExtrato(items, defaultClienteId) {
  if (!Array.isArray(items)) return { created: 0, skipped: 0 };
  let created = 0;
  let skipped = 0;

  // Agrupa por cliente
  const groups = new Map();
  for (const it of items) {
    const cid = Number(it.cliente_id || defaultClienteId);
    if (!cid) continue;
    if (!groups.has(cid)) groups.set(cid, []);
    groups.get(cid).push(it);
  }

  for (const [cid, list] of groups.entries()) {
    const cli = await prisma.cliente.findUnique({ where: { id: cid } });
    if (!cli) continue;

    // Carrega lançamentos ja existentes do cliente (qualquer tipo)
    const existing = await prisma.movimentacao.findMany({
      where: { clienteId: cid },
      select: {
        id: true, dataNf: true, duimpDiProcesso: true,
        tipoMovimento: true, valor: true,
      },
    });
    const existingNorm = existing.map(e => ({
      tipo: e.tipoMovimento || '',
      valor: Math.abs(Number(e.valor) || 0),
      data: dateStr(e.dataNf),
      duimp: e.duimpDiProcesso || '',
    }));

    const createdNow = [];

    for (const it of list) {
      const norm = {
        tipo: it.tipo_movimento || 'Créditos Reconhecidos e Cedidos',
        valor: Math.abs(Number(it.valor) || 0),
        data: it.data_nf || '',
        duimp: it.duimp_di_processo || '',
      };

      const dupDb = existingNorm.some(e => isSimilar(e, norm));
      if (dupDb) { skipped++; continue; }

      const dupBatch = createdNow.some(c => isSimilar(c, norm));
      if (dupBatch) { skipped++; continue; }

      const tipo  = norm.tipo;
      const valor = norm.valor;
      const ajustado = tipo.includes('Débito') ? -valor : valor;

      await prisma.movimentacao.create({
        data: {
          clienteId: cid,
          tipoMovimento: tipo,
          dataNf: isoToDateBr(it.data_nf),
          duimpDiProcesso: it.duimp_di_processo || null,
          parceiro: cli.escritorio || null,
          percentual: Number(it.percentual) || 0,
          valor, valorAjustado: ajustado,
        },
      });
      createdNow.push(norm);
      created++;
    }
  }

  return { created, skipped };
}
