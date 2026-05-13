// =====================================================================
// Parser do XLSX oficial do Siscomex — Tratamento Administrativo.
// Suporta tanto o ta-imp-anuenteweb.xlsx (LI/DI) quanto o ta_lpco_att_imp.xlsx
// (Portal Único / Duimp). Detecta header automaticamente nas primeiras 15
// linhas e identifica colunas pelo nome (com fold de acentos/case).
//
// Saída: CSV no formato aceito pelo importer (Parâmetros → Tratamento Adm):
//   ncm,anuente,descricao,obrigatorio
//
// Uso:
//   node scripts/parse-anuentes.mjs <caminho-xlsx> [saida.csv]
//   node scripts/parse-anuentes.mjs ta-imp-anuenteweb.xlsx ta-imp-anuenteweb.xlsx
//                                   prisma/data/anuentes.csv   (mescla dois)
// =====================================================================
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// ─── CLI ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (!args.length) {
  console.error('Uso: node scripts/parse-anuentes.mjs <xlsx1> [xlsx2 ...] [saida.csv]');
  console.error('Saída default: prisma/data/anuentes-processado.csv');
  process.exit(1);
}
// Último argumento ".csv" é saída; resto são entradas
const lastArg = args[args.length - 1];
let outputPath;
let inputs;
if (lastArg.toLowerCase().endsWith('.csv')) {
  outputPath = lastArg;
  inputs = args.slice(0, -1);
} else {
  outputPath = path.join(root, 'prisma', 'data', 'anuentes-processado.csv');
  inputs = args;
}
if (!inputs.length) {
  console.error('Forneça ao menos 1 xlsx de entrada');
  process.exit(1);
}
for (const f of inputs) {
  if (!fs.existsSync(f)) { console.error(`Arquivo não encontrado: ${f}`); process.exit(1); }
}

// ─── Utils ───────────────────────────────────────────────────────────
function fold(s) {
  return String(s||'').toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function cleanNcm(v) { return String(v||'').replace(/\D/g, '').slice(0, 8); }

// Normaliza nomes de órgãos pra siglas canônicas (case insensitive, sem acento)
// Cobre variações comuns que aparecem na coluna "Órgão" dos arquivos do Siscomex.
const NORMALIZE_AGENCY = [
  [/\banvisa\b/i,                'ANVISA'],
  [/\b(mapa|vigiagro|min(ist)?\.?\s*agric)\b/i, 'MAPA'],
  [/\bibama\b/i,                 'IBAMA'],
  [/\banatel\b/i,                'ANATEL'],
  [/\binmetro\b/i,               'INMETRO'],
  [/\bdpf\b|\bpolicia\s*federal\b/i, 'POLICIA_FEDERAL'],
  [/\bex[ée]rcito\b|\bdfpc\b|\bcomex(er)?\b/i, 'EXERCITO'],
  [/\bmarinha\b/i,               'MARINHA'],
  [/\banp\b/i,                   'ANP'],
  [/\banac\b/i,                  'ANAC'],
  [/\biphan\b/i,                 'IPHAN'],
  [/\bcnen\b/i,                  'CNEN'],
  [/\bmcti\b/i,                  'MCTI'],
  [/\bdecex\b/i,                 'DECEX'],
  [/\bsuframa\b/i,               'SUFRAMA'],
  [/\baneel\b/i,                 'ANEEL'],
  [/\bancine\b/i,                'ANCINE'],
  [/\bdnpm\b|\banm\b/i,          'ANM'],
  [/\bdecea\b/i,                 'DECEA'],
  [/\bibge\b/i,                  'IBGE'],
  [/\b(seprodef|cgaero)\b/i,     'AERONAUTICA'],
];
function normalizeAgency(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  for (const [re, sig] of NORMALIZE_AGENCY) if (re.test(s)) return sig;
  // Sigla curta em caixa alta no início (ex.: "DECEX - ..."): pega a sigla
  const m = s.match(/^([A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,12})(?:\s*[-:/].*)?$/);
  if (m) return m[1].toUpperCase();
  return s.slice(0, 60).toUpperCase();
}

// Parseia "obrigatoriedade" / "tipo de anuência" / etc.
// True quando o controle é "obrigatório" / "anuência prévia"; false quando é
// "monitoramento" / "facultativo" / "em determinadas condições".
function parseObrig(v, defaultVal = true) {
  if (v == null || v === '') return defaultVal;
  const s = fold(v);
  if (/(obrig|previa|autoriz|licen|certif|proib)/.test(s)) return true;
  if (/(monitor|facult|cond|opcional|naoexig|naoseaplica)/.test(s)) return false;
  return defaultVal;
}

// Detecção de colunas (mais lenientes que o importer, pra cobrir o vocabulário
// específico do Siscomex). Retorna { ncm, anuente, descricao, obrigatorio, score }.
function detectCols(headers) {
  const map = { _score: 0 };
  function set(k, i) { if (!(k in map)) { map[k] = i; map._score++; } }
  for (let i = 0; i < headers.length; i++) {
    const h = fold(headers[i]);
    if (!h) continue;
    if (/^(ncm|codigoncm|sh|codigo)$/.test(h)) set('ncm', i);
    if (/(orgao|anuente|orgaoanuente|orgaoresponsavel|controlador)/.test(h)) set('anuente', i);
    // "Descrição da Mercadoria", "Mercadoria", "Descrição NCM", "Produto"
    if (/(descricao|mercadoria|produto|nomencla)/.test(h)) set('descricao', i);
    // "Tipo de Anuência", "Tratamento", "Tipo de Controle", "Obrigatoriedade"
    if (/(tipoanuencia|tipodecontrole|tipocontrole|tratamento|obrig|natureza|modalidade|controleadm)/.test(h)) set('obrigatorio', i);
  }
  return map;
}

function findHeaderRow(rows) {
  let best = null, bestScore = 0;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const cols = detectCols(rows[i].map(String));
    if (typeof cols.ncm !== 'number') continue;
    if (typeof cols.anuente !== 'number') continue;
    // Próxima linha deve ter NCM válido
    const nxt = cleanNcm(rows[i+1]?.[cols.ncm]);
    if (!nxt || nxt.length < 2) continue;
    if (cols._score > bestScore) { best = { idx: i, cols }; bestScore = cols._score; }
  }
  return best;
}

// ─── Processamento ────────────────────────────────────────────────────
// Chave: ncm + anuente. Última fonte vence (caso o user mescle dois arquivos).
const entradas = new Map(); // key = `${ncm}|${anuente}` → { ncm, anuente, descricao, obrigatorio, fonte }

for (const inputPath of inputs) {
  const fonte = path.basename(inputPath);
  console.log(`\n── Processando: ${fonte} ──`);
  const wb = XLSX.read(fs.readFileSync(inputPath), { type: 'buffer', codepage: 65001 });
  console.log(`  Abas:`, wb.SheetNames);

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) continue;

    const hdr = findHeaderRow(rows);
    if (!hdr) {
      console.log(`  ⏭  ${sheetName}: header não encontrado, pulando`);
      continue;
    }
    const { idx: headerRowIdx, cols } = hdr;
    console.log(`  ✓ ${sheetName}: header na linha ${headerRowIdx+1}, mapeamento:`, JSON.stringify(cols));

    let added = 0, skipped = 0;
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const ncm = cleanNcm(r[cols.ncm]);
      if (!ncm || ncm.length < 2) { skipped++; continue; }
      const anuente = normalizeAgency(r[cols.anuente]);
      if (!anuente) { skipped++; continue; }
      const descricao = cols.descricao != null ? String(r[cols.descricao] || '').trim() : '';
      const obrigatorio = cols.obrigatorio != null
        ? parseObrig(r[cols.obrigatorio], true)
        : true;
      const key = `${ncm}|${anuente}`;
      entradas.set(key, { ncm, anuente, descricao: descricao.slice(0, 500), obrigatorio, fonte });
      added++;
    }
    console.log(`    → ${added} regras adicionadas, ${skipped} linhas puladas`);
  }
}

// ─── Saída CSV ────────────────────────────────────────────────────────
const header = ['ncm', 'anuente', 'descricao', 'obrigatorio'];
const out = [header];
for (const { ncm, anuente, descricao, obrigatorio } of entradas.values()) {
  out.push([ncm, anuente, descricao, obrigatorio ? 'sim' : 'nao']);
}
const csv = out.map(row =>
  row.map(c => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')
).join('\n');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, csv);

// ─── Resumo ───────────────────────────────────────────────────────────
console.log(`\n✓ CSV gerado: ${outputPath}`);
console.log(`  Total de regras: ${entradas.size}`);

// Top órgãos
const porAnuente = new Map();
for (const e of entradas.values()) porAnuente.set(e.anuente, (porAnuente.get(e.anuente) || 0) + 1);
const top = [...porAnuente.entries()].sort((a,b) => b[1] - a[1]);
console.log(`  Órgãos cobertos (${top.length}):`);
for (const [a, n] of top) console.log(`    ${a.padEnd(20)} ${n}`);

// Distribuição de granularidade
const lengths = { 2:0, 4:0, 6:0, 8:0, outros: 0 };
const ncmsUnicos = new Set();
for (const e of entradas.values()) {
  ncmsUnicos.add(e.ncm);
  lengths[e.ncm.length] = (lengths[e.ncm.length] || 0) + 1;
}
console.log(`  NCMs únicos: ${ncmsUnicos.size}`);
console.log(`  Granularidade (regras por nível): 2-dig=${lengths[2]||0}, 4-dig=${lengths[4]||0}, 6-dig=${lengths[6]||0}, 8-dig=${lengths[8]||0}`);
