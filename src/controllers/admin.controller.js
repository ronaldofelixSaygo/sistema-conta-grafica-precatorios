import { migrateFromOldNeon, wipeMovimentacoes } from '../services/dataMigration.service.js';
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
