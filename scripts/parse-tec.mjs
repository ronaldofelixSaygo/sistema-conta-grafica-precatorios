// =====================================================================
// Parser do XLSX oficial da TEC (Anexos I a X da Resolução Gecex 272/2021).
// Gera CSV com 2 colunas: ncm, ii_aliq.
//
// Ordem de prevalência (do Anexo X, item 1):
//   Anexos IV, V, VI, VIII, IX, X > Anexos I e II
// Estratégia: começa com Anexo II como base, depois aplica overrides
// dos anexos V, VI, IX (mais relevantes pra importação).
//
// Uso: node scripts/parse-tec.mjs <caminho-tec.xlsx> [saida.csv]
// =====================================================================
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.join(root, 'prisma', 'data', 'tec-processado.csv');

if (!inputPath || !fs.existsSync(inputPath)) {
  console.error('Uso: node scripts/parse-tec.mjs <caminho-tec.xlsx>');
  process.exit(1);
}

function cleanNcm(v) { return String(v||'').replace(/\D/g,'').slice(0, 8); }
function parseAliq(v) {
  if (v == null || v === '' || v === '-') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toUpperCase();
  if (!s || s === 'NT' || s === 'N/T') return null;
  const n = parseFloat(s.replace('%','').replace(',','.').trim());
  return Number.isFinite(n) ? n : null;
}

const wb = XLSX.read(fs.readFileSync(inputPath), { type: 'buffer' });
console.log('Abas encontradas:', wb.SheetNames);

const tabela = new Map();        // ncm -> { ii, fonte }
const ufFontes = { 'Anexo II': 0, 'Anexo V': 0, 'Anexo VI': 0, 'Anexo IX': 0 };

function processar(nomeAba, colNcm, colAliq, headerRow, fonte) {
  const sheet = wb.Sheets[nomeAba];
  if (!sheet) { console.warn(`⚠ Aba "${nomeAba}" não encontrada`); return; }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  let count = 0;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const ncm = cleanNcm(r[colNcm]);
    if (!ncm || ncm.length < 4) continue;
    const ii = parseAliq(r[colAliq]);
    if (ii == null) continue;
    tabela.set(ncm, { ii, fonte });
    count++;
  }
  ufFontes[fonte] = count;
  console.log(`✓ ${fonte}: ${count} entradas`);
}

// Ordem importa (último vence pelo overwrite de Map.set)
processar('Anexo II - Diferentes da TEC', 0, 5, 2, 'Anexo II');  // Alíquota aplicada (%)
processar('Anexo V - LETEC',              0, 2, 4, 'Anexo V');   // Alíquota (%)
processar('Anexo IX - DCC',               0, 2, 3, 'Anexo IX');  // Alíquota (%)
processar('Anexo VI - LEBITBK',           0, 3, 3, 'Anexo VI');  // Alíquota (%) — geralmente reduzida BIT/BK

// Gera CSV
const out = [['ncm', 'ii_aliq']];
for (const [ncm, info] of tabela) {
  out.push([ncm, info.ii]);
}
const csv = out.map(row =>
  row.map(c => {
    const s = String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')
).join('\n');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, csv);

console.log(`\n✓ CSV gerado: ${outputPath}`);
console.log(`  Total NCMs únicos: ${tabela.size}`);
console.log(`  Tamanho: ${(csv.length/1024).toFixed(1)} KB`);
console.log(`  Fontes: ${JSON.stringify(ufFontes)}`);

// Sample: mostra alguns NCMs relevantes
const samples = ['85176259', '85176277', '85171291', '84713019', '87032310', '30049099'];
console.log(`\nAmostras:`);
for (const ncm of samples) {
  const v = tabela.get(ncm);
  console.log(`  ${ncm}: ${v ? `${v.ii}% (${v.fonte})` : 'não encontrado'}`);
}
