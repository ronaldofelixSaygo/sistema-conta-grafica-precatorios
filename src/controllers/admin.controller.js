import { migrateFromOldNeon } from '../services/dataMigration.service.js';
import { logAction } from '../services/audit.service.js';

export async function migrateFromOld(req, res, next) {
  try {
    const { oldDatabaseUrl, dryRun } = req.body || {};
    const summary = await migrateFromOldNeon({ oldDatabaseUrl, dryRun: !!dryRun });
    await logAction({
      user: req.user, action: 'MIGRATE_DATA', entity: 'admin',
      details: JSON.stringify({
        dryRun: !!dryRun,
        users: summary.users,
        clientes: summary.clientes,
        movs: summary.movimentacoes,
      }),
      ip: req.ip,
    });
    res.json(summary);
  } catch (e) { next(e); }
}
