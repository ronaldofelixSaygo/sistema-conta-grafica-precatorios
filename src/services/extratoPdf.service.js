// =====================================================================
// Importacao de Extrato PDF (formato detalhado).
//
// O PDF tem 3 secoes, cada uma com seu cabecalho:
//   • Créditos Reconhecidos e Cedidos   → tipo = crédito
//   • Débitos de Transferências         → tipo = débito (transferência)
//   • Débitos de Liquidações            → tipo = débito (liquidação)
//
// Como a coluna de valor débito vem sem sinal de menos, NAO da pra
// classificar pelo sinal — o parser rastreia a secao corrente.
//
// O apply faz dedup por assinatura (cliente+data+duimp+tipo+valor)
// para evitar duplicar lançamentos quando o usuario re-importa o
// mesmo PDF. Duplicatas legitimas dentro do PDF (mesmas chaves)
// continuam sendo criadas — o algoritmo conta repetições.
// =====================================================================
import { prisma } from '../config/prisma.js';

async function extractText(buffer) {
  // pdfjs-dist em modo legacy (compativel com Node)
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
  // dd/mm/yyyy ou dd-mm-yyyy
  const m = String(str).match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
function parseValor(str) {
  // formato BR: 1.234,56 ou negativo "-1.234,56" / "(1.234,56)"
  let s = String(str).trim().replace(/[\s\xa0]/g, '');
  let neg = false;
  if (s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'))) {
    neg = true; s = s.replace(/^[(-]|[)]$/g, '');
  }
  s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s); if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

// Anchora a data em 12:00 UTC -> 09:00 BRT, evitando shift de timezone
// quando a coluna DateTime do Postgres for lida em fuso BR.
function isoToDateBr(isoYmd) {
  if (!isoYmd) return null;
  return new Date(`${isoYmd}T12:00:00.000Z`);
}

// Cabeçalhos de seção e tipo de movimento correspondente.
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

// Linhas obviamente de cabeçalho/rodapé que não são lançamentos.
function isHeaderOrFooter(line) {
  return /per[ií]odo\s*:|gerado\s+em|p[áa]gina\s+\d+\s+de|saldo\s+total|^data\s+(n[º°o]\s+processo|duimp)/i
    .test(line);
}

export async function previewExtrato(buffer) {
  const text = await extractText(buffer);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const items = [];
  // Default: caso o PDF venha sem cabeçalhos detectáveis, classifica como crédito.
  let currentTipo = 'Créditos Reconhecidos e Cedidos';

  for (const line of lines) {
    // Troca de seção: a propria linha do header (que pode ter total) é descartada
    const sec = detectSection(line);
    if (sec) { currentTipo = sec; continue; }

    if (isHeaderOrFooter(line)) continue;

    const date = parseDate(line);
    if (!date) continue;

    // Valores monetários presentes na linha
    const matches = [...line.matchAll(/-?\(?\d{1,3}(?:\.\d{3})*,\d{2}\)?/g)];
    if (matches.length === 0) continue;
    // Para Débitos de Liquidações o PDF tem "ICMS Devido R$ 0,00 ... Valor Débito R$ X,XX".
    // O último valor da linha é sempre o que queremos.
    const valor = parseValor(matches[matches.length - 1][0]);
    if (valor == null) continue;
    if (Math.abs(valor) < 0.005) continue; // ignora R$ 0,00

    // DUIMP/DI/Processo: numero longo na linha (10-15 dígitos ou 22BR...)
    const duimpMatch = line.match(/\b(\d{2}BR\d{8,12}|\d{10,15})\b/);
    const duimp = duimpMatch ? duimpMatch[1] : null;

    items.push({
      data_nf: date,
      duimp_di_processo: duimp,
      tipo_movimento: currentTipo,
      valor: Math.abs(valor),
      _raw: line.slice(0, 200),
    });
  }
  return { count: items.length, items };
}

// Aplica os items aprovados, com dedup por assinatura
// (cliente+data+duimp+tipo+valor). Re-importações nao duplicam.
export async function applyExtrato(items, defaultClienteId) {
  if (!Array.isArray(items)) return { created: 0, skipped: 0 };
  let created = 0;
  let skipped = 0;

  // 1) Agrupa items por cliente
  const groups = new Map(); // clienteId -> items[]
  for (const it of items) {
    const cid = Number(it.cliente_id || defaultClienteId);
    if (!cid) continue;
    if (!groups.has(cid)) groups.set(cid, []);
    groups.get(cid).push(it);
  }

  const sigOf = (it) => {
    const tipo  = it.tipo_movimento || 'Créditos Reconhecidos e Cedidos';
    const valor = Math.abs(Number(it.valor) || 0);
    const data  = it.data_nf || '';
    const duimp = it.duimp_di_processo || '';
    return `${data}|${duimp}|${tipo}|${valor.toFixed(2)}`;
  };

  for (const [cid, list] of groups.entries()) {
    const cli = await prisma.cliente.findUnique({ where: { id: cid } });
    if (!cli) continue;

    // 2) Conta repetições da PDF por assinatura
    const sigPdf = new Map();
    for (const it of list) {
      const s = sigOf(it);
      sigPdf.set(s, (sigPdf.get(s) || 0) + 1);
    }

    // 3) Conta o que já existe no banco para esse cliente
    const existing = await prisma.movimentacao.findMany({
      where: { clienteId: cid },
      select: {
        id: true, dataNf: true, duimpDiProcesso: true,
        tipoMovimento: true, valor: true,
      },
    });
    const sigDb = new Map();
    for (const e of existing) {
      const data  = e.dataNf ? new Date(e.dataNf).toISOString().slice(0, 10) : '';
      const duimp = e.duimpDiProcesso || '';
      const tipo  = e.tipoMovimento || '';
      const valor = Math.abs(Number(e.valor) || 0);
      const s = `${data}|${duimp}|${tipo}|${valor.toFixed(2)}`;
      sigDb.set(s, (sigDb.get(s) || 0) + 1);
    }

    // 4) Cria apenas o necessário para igualar a contagem do PDF
    const sigCreatedNow = new Map();
    for (const it of list) {
      const s = sigOf(it);
      const wanted = sigPdf.get(s) || 0;
      const inDb   = sigDb.get(s) || 0;
      const alreadyNow = sigCreatedNow.get(s) || 0;
      if (inDb + alreadyNow >= wanted) { skipped++; continue; }

      const tipo  = it.tipo_movimento || 'Créditos Reconhecidos e Cedidos';
      const valor = Math.abs(Number(it.valor) || 0);
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
      sigCreatedNow.set(s, alreadyNow + 1);
      created++;
    }
  }

  return { created, skipped };
}
