// =====================================================================
// Parser do TIPI.xlsx oficial da Receita Federal — gera CSV limpo
// pra ser importado via /api/admin/ncm-import.
//
// Uso: node scripts/parse-tipi.mjs <caminho-tipi.xlsx> [saida.csv]
// Default saida: prisma/data/tipi-processado.csv
// =====================================================================
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.join(root, 'prisma', 'data', 'tipi-processado.csv');

if (!inputPath || !fs.existsSync(inputPath)) {
  console.error('❌ Informe o caminho do tipi.xlsx');
  console.error('Uso: node scripts/parse-tipi.mjs <caminho-tipi.xlsx>');
  process.exit(1);
}

function cleanNcm(v) { return String(v||'').replace(/\D/g, '').slice(0, 8); }

function parseAliq(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (!s || s === 'NT' || s === 'N/T' || s === '-') return 0; // NT = não tributado
  const n = parseFloat(s.replace('%','').replace(',','.').trim());
  return Number.isFinite(n) ? n : null;
}

const wb = XLSX.read(fs.readFileSync(inputPath), { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

// Procura linha do header (NCM, EX, DESCRIÇÃO, ALÍQUOTA)
let headerIdx = -1;
for (let i = 0; i < Math.min(15, rows.length); i++) {
  const r = rows[i].map(s => String(s).toUpperCase());
  if (r.some(c => c.includes('NCM')) && r.some(c => c.includes('DESCRI')) && r.some(c => c.includes('ALÍQUOTA') || c.includes('ALIQUOTA'))) {
    headerIdx = i; break;
  }
}
if (headerIdx < 0) { console.error('❌ Cabeçalho não encontrado'); process.exit(1); }

// Mapeia colunas
const header = rows[headerIdx].map(s => String(s).toUpperCase().trim());
const colNcm   = header.findIndex(c => c.includes('NCM'));
const colDesc  = header.findIndex(c => c.includes('DESCRI'));
const colAliq  = header.findIndex(c => c.includes('ALÍQUOTA') || c.includes('ALIQUOTA'));

console.log(`Header na linha ${headerIdx}: NCM=col${colNcm}, DESC=col${colDesc}, ALIQ=col${colAliq}`);

const out = [['ncm', 'descricao', 'ipi_aliq', 'pis_aliq', 'cofins_aliq']];
let total = 0, ignorados = 0, capitulos = 0;

for (let i = headerIdx + 1; i < rows.length; i++) {
  const r = rows[i];
  const ncm = cleanNcm(r[colNcm]);
  if (!ncm) { ignorados++; continue; }
  // Capítulos (2 dígitos), posições (4) e subposições (6) entram tbm pra fallback hierárquico
  if (ncm.length < 8 && ncm.length !== 2 && ncm.length !== 4 && ncm.length !== 6 && ncm.length !== 7) { ignorados++; continue; }
  const desc = String(r[colDesc] || '').trim().replace(/\s+/g,' ').slice(0, 400);
  const aliq = parseAliq(r[colAliq]);
  // Linhas de capítulo/posição não têm alíquota — marca como 0 mas mantém pra fallback
  const ipi = aliq ?? 0;
  out.push([ncm, desc.replace(/"/g,'""'), ipi, 2.1, 9.65]);
  total++;
  if (ncm.length < 8) capitulos++;
}

const csv = out.map(row =>
  row.map(c => {
    const s = String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')
).join('\n');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, csv);

console.log(`✓ CSV gerado: ${outputPath}`);
console.log(`  Total NCMs: ${total}`);
console.log(`  Capítulos/posições/subposições (fallback): ${capitulos}`);
console.log(`  Subitens (8 dígitos): ${total - capitulos}`);
console.log(`  Ignorados: ${ignorados}`);
console.log(`  Tamanho: ${(csv.length/1024).toFixed(1)} KB`);
