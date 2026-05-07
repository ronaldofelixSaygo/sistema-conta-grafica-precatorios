// =====================================================================
// Migra dados do banco antigo (SQLite database.sqlite do conta-grafica)
// para o Neon usando Prisma. Idempotente: ignora registros já existentes.
//
// Como rodar:
//   1. Configure DATABASE_URL no .env (string do Neon)
//   2. Execute as migrations: npx prisma migrate deploy
//   3. Defina LEGACY_SQLITE_PATH no .env apontando p/ o database.sqlite antigo
//      ex.: LEGACY_SQLITE_PATH="C:\\Users\\RonaldoFélix\\Documents\\conta-grafica\\database.sqlite"
//   4. npm run migrate:from-sqlite
// =====================================================================
import 'dotenv/config';
import fs from 'node:fs';
import initSqlJs from 'sql.js';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const dbPath = process.env.LEGACY_SQLITE_PATH;

function rowsOf(result) {
  if (!result || !result.length) return [];
  const cols = result[0].columns;
  return result[0].values.map(v => Object.fromEntries(cols.map((c, i) => [c, v[i]])));
}
function parseDate(v) {
  if (!v) return null;
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

async function main() {
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error('✗ LEGACY_SQLITE_PATH não definido ou arquivo inexistente.');
    console.error('  Defina no .env, ex.: LEGACY_SQLITE_PATH="C:\\\\path\\\\database.sqlite"');
    process.exit(1);
  }
  console.log(`▶ Lendo SQLite: ${dbPath}`);

  const SQL = await initSqlJs();
  const buf = fs.readFileSync(dbPath);
  const db  = new SQL.Database(buf);

  // ── USERS ───────────────────────────────────────────────────────
  // Estratégia: trazer todos como ADM se role='admin', senão SAYGO.
  const usersRaw = rowsOf(db.exec('SELECT * FROM users'));
  let usersOk = 0;
  for (const u of usersRaw) {
    const email = String(u.email || '').trim().toLowerCase();
    if (!email) continue;
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) continue;
    const role = u.role === 'admin' ? 'ADM' : 'SAYGO';
    // Se a senha do legado já era bcrypt válido, mantém; senão gera hash de
    // uma senha temporária e o usuário troca depois.
    const looksHashed = typeof u.password === 'string' && u.password.startsWith('$2');
    const passwordHash = looksHashed
      ? u.password
      : await bcrypt.hash('TrocarSenha123!', 10);
    await prisma.user.create({
      data: {
        email, name: u.name || email, role, active: true, passwordHash,
      },
    });
    usersOk++;
  }
  console.log(`✓ Usuários migrados: ${usersOk} (existentes ignorados)`);

  // ── CLIENTES ────────────────────────────────────────────────────
  const cliRaw = rowsOf(db.exec('SELECT * FROM clientes'));
  // Mapa idAntigo→idNovo p/ relacionar movimentações
  const cliMap = new Map();
  let cliOk = 0;
  for (const c of cliRaw) {
    // Tenta achar por nome+escritorio para evitar duplicar
    const found = await prisma.cliente.findFirst({
      where: { nome: c.nome, escritorio: c.escritorio || null },
    });
    if (found) { cliMap.set(c.id, found.id); continue; }
    const created = await prisma.cliente.create({
      data: {
        nome: c.nome,
        cnpj: c.cnpj || null,
        cnpjFilial: c.cnpj_filial || null,
        escritorio: c.escritorio || null,
        locacaoSala: c.locacao_sala || null,
        aberturaFilial: c.abertura_filial || null,
        reativacaoIe: c.reativacao_ie || null,
        contaGrafica: c.conta_grafica || null,
        clienteCertificado: c.cliente_certificado || null,
        parceiroSala: c.parceiro_sala || null,
        parceiroFilial: c.parceiro_filial || null,
        parceiroIe: c.parceiro_ie || null,
        observacoes: c.observacoes || null,
        percentualComissao: Number(c.percentual_comissao) || 0,
        diaFechamento: Number(c.dia_fechamento) || 1,
      },
    });
    cliMap.set(c.id, created.id);
    cliOk++;
  }
  console.log(`✓ Clientes migrados: ${cliOk} (já existentes ignorados)`);

  // ── MOVIMENTAÇÕES ──────────────────────────────────────────────
  const movsRaw = rowsOf(db.exec('SELECT * FROM movimentacoes'));
  let movsOk = 0;
  for (const m of movsRaw) {
    const novoCliId = cliMap.get(m.cliente_id);
    if (!novoCliId) continue;
    // De-dup grosseiro: mesmo cliente + tipo + data + valor + duimp
    const exists = await prisma.movimentacao.findFirst({
      where: {
        clienteId: novoCliId,
        tipoMovimento: m.tipo_movimento || '',
        dataNf: parseDate(m.data_nf),
        valor: Number(m.valor) || 0,
        duimpDiProcesso: m.duimp_di_processo || null,
      },
    });
    if (exists) continue;
    await prisma.movimentacao.create({
      data: {
        clienteId: novoCliId,
        tipoMovimento: m.tipo_movimento || '',
        dataNf: parseDate(m.data_nf),
        duimpDiProcesso: m.duimp_di_processo || null,
        parceiro: m.parceiro || null,
        dataExoneracao: parseDate(m.data_exoneracao),
        percentual: Number(m.percentual) || 0,
        valor: Number(m.valor) || 0,
        valorAjustado: m.valor_ajustado != null
          ? Number(m.valor_ajustado)
          : calcAjustado(m.tipo_movimento, m.valor),
      },
    });
    movsOk++;
  }
  console.log(`✓ Movimentações migradas: ${movsOk}`);

  console.log('\nMigração concluída ✅');
}

main().catch(e => { console.error(e); process.exit(1); })
      .finally(() => prisma.$disconnect());
