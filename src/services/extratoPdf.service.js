// =====================================================================
// Importacao de Extrato PDF (parser inspirado no sistema antigo).
// Estrategia: extrai texto do PDF e tenta identificar linhas de
// movimentacao por padroes comuns (data + DUIMP + valor).
// O cliente pode ajustar o resultado antes de aplicar.
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
  const m = str.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
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

// Heuristica simples: cada linha que tem uma data + um valor monetario vira uma mov
export async function previewExtrato(buffer) {
  const text = await extractText(buffer);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    const date = parseDate(line);
    if (!date) continue;
    // Pega o ultimo numero formato BR como valor
    const matches = [...line.matchAll(/-?\(?\d{1,3}(?:\.\d{3})*,\d{2}\)?/g)];
    if (matches.length === 0) continue;
    const valor = parseValor(matches[matches.length - 1][0]);
    if (valor == null) continue;
    // DUIMP/DI: tenta extrair numero longo
    const duimpMatch = line.match(/\b(\d{2}BR\d{8,12}|\d{10,15})\b/);
    const duimp = duimpMatch ? duimpMatch[1] : null;
    // Tipo provavel pelo sinal: positivo=Credito, negativo=Debito Liquidacoes
    const tipo = valor < 0 ? 'Débitos de Liquidações' : 'Créditos Reconhecidos e Cedidos';
    items.push({
      data_nf: date,
      duimp_di_processo: duimp,
      tipo_movimento: tipo,
      valor: Math.abs(valor),
      _raw: line.slice(0, 200),
    });
  }
  return { count: items.length, items };
}

// Aplica os items aprovados (frontend ja identificou o cliente para cada um)
export async function applyExtrato(items, defaultClienteId) {
  if (!Array.isArray(items)) return { created: 0 };
  let created = 0;
  for (const it of items) {
    const clienteId = Number(it.cliente_id || defaultClienteId);
    if (!clienteId) continue;
    const cli = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cli) continue;
    const tipo = it.tipo_movimento || 'Créditos Reconhecidos e Cedidos';
    const valor = Math.abs(Number(it.valor) || 0);
    const ajustado = tipo.includes('Débito') ? -valor : valor;
    await prisma.movimentacao.create({
      data: {
        clienteId,
        tipoMovimento: tipo,
        dataNf: it.data_nf ? new Date(it.data_nf) : null,
        duimpDiProcesso: it.duimp_di_processo || null,
        parceiro: cli.escritorio || null,
        percentual: Number(it.percentual) || 0,
        valor, valorAjustado: ajustado,
      },
    });
    created++;
  }
  return { created };
}
