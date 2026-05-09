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
