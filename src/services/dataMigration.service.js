// =====================================================================
// Migração Neon antigo → Neon novo. Versão otimizada com createMany
// em lotes, evitando timeout no Render.
// =====================================================================
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';

function calcAjustado(tipo, valor) {
  const v = Math.abs(Number(valor) || 0);
  if (!tipo) return 0;
  if (String(tipo).includes('Débito')) return -v;
  if (String(tipo).includes('Crédito')) return v;
  return 0;
}

export async function migrateFromOldNeon({ oldDatabaseUrl, dryRun = false, wipeMovs = false }) {
  if (!oldDatabaseUrl) {
    const e = new Error('oldDatabaseUrl é obrigatório'); e.status = 400; throw e;
  }
  const old = new pg.Client({
    connectionString: oldDatabaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await old.connect();

  const summary = {
    users: { read: 0, created: 0, skipped: 0, errors: [] },
    clientes: { read: 0, created: 0, skipped: 0, errors: [] },
    movimentacoes: { read: 0, created: 0, skipped: 0, errors: [], wipedBefore: 0 },
    audit: { read: 0, created: 0, skipped: 0 },
    dryRun,
  };

  try {
    // ── USERS ────────────────────────────────────────────────────
    const usersR = await old.query('SELECT * FROM users');
    summary.users.read = usersR.rows.length;
    for (const u of usersR.rows) {
      try {
        const email = String(u.email || '').trim().toLowerCase();
        if (!email) { summary.users.skipped++; continue; }
        const exists = await prisma.user.findUnique({ where: { email } });
        if (exists) { summary.users.skipped++; continue; }
        if (dryRun) continue;
        const role = u.role === 'admin' ? 'ADM' : 'SAYGO';
        const looksHashed = typeof u.password === 'string' && u.password.startsWith('$2');
        const passwordHash = looksHashed ? u.password : await bcrypt.hash('TrocarSenha123!', 10);
        await prisma.user.create({
          data: { email, name: u.name || email, role, active: true, passwordHash },
        });
        summary.users.created++;
      } catch (e) { summary.users.errors.push(e.message); }
    }

    // ── CLIENTES ─────────────────────────────────────────────────
    const cliR = await old.query('SELECT * FROM clientes ORDER BY id');
    summary.clientes.read = cliR.rows.length;
    const cliMap = new Map();
    for (const c of cliR.rows) {
      try {
        const found = await prisma.cliente.findFirst({
          where: { nome: c.nome, escritorio: c.escritorio || null },
        });
        if (found) { cliMap.set(c.id, found.id); summary.clientes.skipped++; continue; }
        if (dryRun) continue;
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
        summary.clientes.created++;
      } catch (e) { summary.clientes.errors.push(`cliente ${c.id}: ${e.message}`); }
    }

    // ── MOVIMENTAÇÕES (createMany em lotes) ─────────────────────
    if (wipeMovs && !dryRun) {
      const r = await prisma.movimentacao.deleteMany({});
      summary.movimentacoes.wipedBefore = r.count;
    }

    const movsR = await old.query('SELECT * FROM movimentacoes ORDER BY id');
    summary.movimentacoes.read = movsR.rows.length;

    if (!dryRun) {
      const BATCH = 500;
      let buffer = [];
      const flush = async () => {
        if (!buffer.length) return;
        try {
          const r = await prisma.movimentacao.createMany({ data: buffer, skipDuplicates: true });
          summary.movimentacoes.created += r.count;
        } catch (e) {
          summary.movimentacoes.errors.push(`batch: ${e.message}`);
        }
        buffer = [];
      };

      for (const m of movsR.rows) {
        const novoCliId = cliMap.get(m.cliente_id);
        if (!novoCliId) { summary.movimentacoes.skipped++; continue; }
        buffer.push({
          clienteId: novoCliId,
          tipoMovimento: m.tipo_movimento || '',
          dataNf: m.data_nf ? new Date(m.data_nf) : null,
          duimpDiProcesso: m.duimp_di_processo || null,
          parceiro: m.parceiro || null,
          dataExoneracao: m.data_exoneracao ? new Date(m.data_exoneracao) : null,
          percentual: Number(m.percentual) || 0,
          valor: Number(m.valor) || 0,
          valorAjustado: m.valor_ajustado != null
            ? Number(m.valor_ajustado)
            : calcAjustado(m.tipo_movimento, m.valor),
        });
        if (buffer.length >= BATCH) await flush();
      }
      await flush();
    }

    return summary;
  } finally {
    await old.end();
  }
}

// Wipe simples
export async function wipeMovimentacoes() {
  const r = await prisma.movimentacao.deleteMany({});
  return { deleted: r.count };
}
