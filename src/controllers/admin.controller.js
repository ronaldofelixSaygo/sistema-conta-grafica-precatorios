import { migrateFromOldNeon, wipeMovimentacoes } from '../services/dataMigration.service.js';
import { runNcmSeed, NCM_DATASET_INFO } from '../services/ncmSeed.service.js';
import { importNcmFile } from '../services/ncmImport.service.js';
import { prisma } from '../config/prisma.js';
import { logAction } from '../services/audit.service.js';

export async function migrateFromOld(req, res, next) {
  try {
    const { oldDatabaseUrl, dryRun, wipeMovs } = req.body || {};
    const summary = await migrateFromOldNeon({ oldDatabaseUrl, dryRun: !!dryRun, wipeMovs: !!wipeMovs });
    await logAction({
      user: req.user, action: 'MIGRATE_DATA', entity: 'admin',
      details: JSON.stringify({
        dryRun: !!dryRun, wipeMovs: !!wipeMovs,
        users: summary.users, clientes: summary.clientes, movs: summary.movimentacoes,
      }),
      ip: req.ip,
    });
    res.json(summary);
  } catch (e) { next(e); }
}

export async function wipeMovs(req, res, next) {
  try {
    const r = await wipeMovimentacoes();
    await logAction({ user: req.user, action: 'WIPE', entity: 'movimentacao', details: `${r.deleted} excluidas`, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}

export async function importNcm(req, res, next) {
  try {
    if (!req.file) { const e = new Error('Arquivo não enviado'); e.status = 400; throw e; }
    const modo = req.body?.modo || req.query?.modo || 'tributos';
    const stats = await importNcmFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      modo,
    });
    await logAction({ user: req.user, action: 'IMPORT_NCM', entity: 'admin',
                      details: JSON.stringify({ modo, importados: stats.importados, atualizados: stats.atualizados, ignorados: stats.ignorados }), ip: req.ip });
    const totals = {
      ncm_tributos: await prisma.ncmTributo.count(),
      ncm_anuentes: await prisma.ncmAnuente.count(),
    };
    res.json({ ok: true, ...stats, totalNoBanco: totals });
  } catch (e) { next(e); }
}

// =====================================================================
// Diagnóstico do scope de PARTNER: por que o usuário tá vendo lista vazia?
// Compara, codepoint por codepoint, o officeName/parceiroNome do user
// com os valores de `escritorio` que existem em clientes.
// Uso: GET /api/admin/scope-debug?email=pedro@doccontabil.com.br
// =====================================================================
function codepoints(s) {
  if (s == null) return null;
  return [...s].map(c => ({ ch: c, cp: 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') }));
}
export async function scopeDebug(req, res, next) {
  try {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email) { const e = new Error('Informe ?email='); e.status = 400; throw e; }
    const u = await prisma.user.findUnique({
      where: { email },
      include: { parceiro: true },
    });
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });

    const office = (u.officeName || u.parceiro?.nome || '').trim();
    // O que o scope ATUAL geraria
    const wherePrisma = office
      ? { escritorio: { equals: office, mode: 'insensitive' } }
      : { id: -1 };
    const countPrisma = await prisma.cliente.count({ where: wherePrisma });

    // E o que um TRIM + LOWER acharia (via raw SQL)
    const trimRows = office
      ? await prisma.$queryRaw`
          SELECT id, nome, escritorio
          FROM clientes
          WHERE LOWER(TRIM(escritorio)) = LOWER(TRIM(${office}))
          LIMIT 5
        `
      : [];

    // Amostra de escritorios distintos (top 20)
    const sampleEscritorios = await prisma.$queryRaw`
      SELECT escritorio, COUNT(*)::int AS n
      FROM clientes
      WHERE escritorio IS NOT NULL
      GROUP BY escritorio
      ORDER BY n DESC
      LIMIT 20
    `;

    res.json({
      user: {
        id: u.id, email: u.email, name: u.name, role: u.role, active: u.active,
        officeName: u.officeName,
        officeName_cp: codepoints(u.officeName),
        parceiroId: u.parceiroId,
        parceiroNome: u.parceiro?.nome || null,
        parceiroNome_cp: codepoints(u.parceiro?.nome),
        parceiroType: u.parceiro?.type || null,
        parceiroKindCode: u.parceiro?.kindCode || null,
      },
      resolved_office: office,
      resolved_office_cp: codepoints(office),
      where_prisma: wherePrisma,
      count_with_prisma_scope: countPrisma,
      matches_with_trim_lower: trimRows.map(r => ({
        ...r,
        escritorio_cp: codepoints(r.escritorio),
      })),
      sample_escritorios: sampleEscritorios.map(r => ({
        escritorio: r.escritorio,
        escritorio_cp: codepoints(r.escritorio),
        count: r.n,
      })),
    });
  } catch (e) { next(e); }
}

// =====================================================================
// Normaliza escritorio em clientes e officeName em users:
// faz TRIM em ambos os campos (não muda case, só tira espaços invisíveis).
// É idempotente — pode rodar quantas vezes quiser.
// Uso: POST /api/admin/scope-fix
// =====================================================================
// =====================================================================
// Estado do storage. Soma os bytes dos blobs em cada tabela e o tamanho
// total do banco. Usado pra acompanhar consumo no Neon free (limite 500 MB).
// =====================================================================
export async function storageStats(_req, res, next) {
  try {
    // Tamanho total do banco (inclui índices e overhead). Em Bytes.
    const dbRow = await prisma.$queryRawUnsafe(`SELECT pg_database_size(current_database())::bigint AS bytes`);
    const databaseSize = Number(dbRow[0]?.bytes || 0);

    // Helper: conta linhas com bytea + soma octet_length da coluna
    async function tally(label, table, column) {
      const sql = `
        SELECT
          COUNT(*) FILTER (WHERE "${column}" IS NOT NULL)::int AS count,
          COALESCE(SUM(octet_length("${column}")), 0)::bigint AS bytes
        FROM "${table}"
      `;
      try {
        const r = await prisma.$queryRawUnsafe(sql);
        return { label, table, column, count: Number(r[0]?.count || 0), bytes: Number(r[0]?.bytes || 0) };
      } catch (e) {
        return { label, table, column, count: 0, bytes: 0, error: e.message };
      }
    }

    const breakdown = await Promise.all([
      tally('Foto de perfil',              'users',                 'avatarBytes'),
      tally('Anexos Kanban',               'kanban_attachments',    'content'),
      tally('PDF entrada Crédito',         'credit_requests',       'inputPdfBytes'),
      tally('PDF evidência Crédito',       'credit_requests',       'resolutionAttachmentBytes'),
      tally('NF oficial (Desonerações)',   'desoneracao_notas',     'oficialBytes'),
      tally('Docs Desonerações',           'desoneracao_documentos','bytes'),
    ]);
    const blobsTotal = breakdown.reduce((s, b) => s + b.bytes, 0);

    res.json({
      databaseSize,
      blobsTotal,
      // Neon free plan: 0,5 GB = 500 * 1024 * 1024 bytes
      limitBytes: 500 * 1024 * 1024,
      breakdown,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) { next(e); }
}

// =====================================================================
// Diagnóstico de e-mail: por que um trigger não disparou?
// Mostra settings completos + recipients pra um cardId opcional.
// Uso: GET /api/admin/email-debug?cardId=<id>
// =====================================================================
export async function emailDebug(req, res, next) {
  try {
    const { default: emailSvc } = await import('../services/email.service.js')
      .then(m => ({ default: m })); // workaround se for namespace
    const settingsRow = await prisma.emailSettings.findUnique({ where: { id: 'default' } });
    const settings = {
      enabled: !!settingsRow?.enabled,
      apiUrl: settingsRow?.apiUrl || null,
      hasApiToken: !!settingsRow?.apiToken,
      sender: settingsRow?.sender || null,
      notifyKanbanStageChange: !!settingsRow?.notifyKanbanStageChange,
      notifyKanbanStageDone:   !!settingsRow?.notifyKanbanStageDone,
      notifyPartnerRequest:    !!settingsRow?.notifyPartnerRequest,
      notifyCreditRequest:     settingsRow?.notifyCreditRequest !== false,
      notifyKanbanStageChangeRoles: settingsRow?.notifyKanbanStageChangeRoles || null,
      notifyKanbanStageDoneRoles:   settingsRow?.notifyKanbanStageDoneRoles   || null,
    };

    // Snapshot de usuários ADM e SAYGO
    const staff = await prisma.user.findMany({
      where: { role: { in: ['ADM','SAYGO'] }, active: true, email: { not: null } },
      select: { id: true, email: true, name: true, role: true },
    });

    let cardSnapshot = null;
    let recipients = null;
    if (req.query.cardId) {
      const card = await prisma.kanbanCard.findUnique({
        where: { id: String(req.query.cardId) },
        include: { cliente: { include: { user: { select: { email: true, name: true } } } } },
      });
      if (card) {
        cardSnapshot = {
          id: card.id,
          clienteId: card.clienteId,
          clienteNome: card.cliente?.nome,
          clienteEscritorio: card.cliente?.escritorio,
          clienteUser: card.cliente?.user || null,
          currentStage: card.currentStage,
        };
        const roles = settings.notifyKanbanStageChangeRoles || ['ADM','SAYGO','PARTNER','CLIENT'];
        const partners = card.cliente?.escritorio ? await prisma.user.findMany({
          where: {
            role: 'PARTNER', active: true, email: { not: null },
            officeName: { equals: String(card.cliente.escritorio).trim(), mode: 'insensitive' },
          },
          select: { email: true, name: true, officeName: true },
        }) : [];
        recipients = {
          roles,
          client:   roles.includes('CLIENT') && card.cliente?.user?.email ? card.cliente.user.email : null,
          partners: roles.includes('PARTNER') ? partners.map(p => p.email) : [],
          staff:    (roles.includes('ADM') || roles.includes('SAYGO')) ? staff.map(s => s.email) : [],
        };
      }
    }

    res.json({
      settings,
      staffCount: staff.length,
      staffEmails: staff.map(s => `${s.name} (${s.email})`),
      cardSnapshot,
      recipients,
      diagnosticNotes: [
        settings.enabled ? null : '⚠ EMAIL_ENABLED está OFF — nenhum e-mail vai disparar',
        settings.notifyKanbanStageChange ? null : '⚠ notifyKanbanStageChange está OFF — clique em "Salvar" na aba E-mail',
        settings.hasApiToken ? null : '⚠ Sem token da API Saygo',
        settings.apiUrl ? null : '⚠ Sem URL da API Saygo',
        staff.length ? null : '⚠ Nenhum usuário ADM/SAYGO ativo com e-mail cadastrado',
      ].filter(Boolean),
    });
  } catch (e) { next(e); }
}

// Dispara o trigger de mudança de fase pra um card específico (uso: teste manual).
// POST /api/admin/email-test-trigger body: { cardId, fromStage, toStage }
export async function emailTestTrigger(req, res, next) {
  try {
    const { cardId, fromStage = 'ONBOARDING', toStage = 'CONTRATACAO_SALA' } = req.body || {};
    if (!cardId) { const e = new Error('cardId obrigatório'); e.status = 400; throw e; }
    const emailMod = await import('../services/email.service.js');
    await emailMod.notifyStageChange({ cardId, fromStage, toStage, byUser: req.user });
    res.json({ ok: true, message: 'Trigger executado — veja Histórico de envios e Logs do Render' });
  } catch (e) { next(e); }
}

export async function scopeFix(req, res, next) {
  try {
    const r1 = await prisma.$executeRaw`
      UPDATE clientes SET escritorio = TRIM(escritorio)
      WHERE escritorio IS NOT NULL AND escritorio <> TRIM(escritorio)
    `;
    const r2 = await prisma.$executeRaw`
      UPDATE users SET "officeName" = TRIM("officeName")
      WHERE "officeName" IS NOT NULL AND "officeName" <> TRIM("officeName")
    `;
    await logAction({
      user: req.user, action: 'SCOPE_FIX', entity: 'admin',
      details: JSON.stringify({ clientes_trim: r1, users_trim: r2 }),
      ip: req.ip,
    });
    res.json({ ok: true, clientes_trimados: r1, users_trimados: r2 });
  } catch (e) { next(e); }
}

export async function seedNcm(req, res, next) {
  try {
    const before = {
      ncm: await prisma.ncmTributo.count(),
      anuentes: await prisma.ncmAnuente.count(),
      ufs: await prisma.icmsUf.count(),
    };
    const r = await runNcmSeed({ resetAnuentes: true });
    const after = {
      ncm: await prisma.ncmTributo.count(),
      anuentes: await prisma.ncmAnuente.count(),
      ufs: await prisma.icmsUf.count(),
    };
    await logAction({ user: req.user, action: 'SEED_NCM', entity: 'admin',
                      details: JSON.stringify(after), ip: req.ip });
    res.json({
      ok: true,
      dataset: NCM_DATASET_INFO,
      processed: r,
      before,
      after,
    });
  } catch (e) { next(e); }
}
