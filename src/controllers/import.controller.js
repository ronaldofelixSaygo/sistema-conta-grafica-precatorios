import { importExcel } from '../services/import.service.js';
import { logAction } from '../services/audit.service.js';

export async function importPlanilha(req, res, next) {
  try {
    if (!req.file) { const e = new Error('Arquivo não enviado (campo: file)'); e.status = 400; throw e; }
    const kind = (req.body?.kind || 'auto').toLowerCase();
    const summary = await importExcel(req.file.buffer, { kind });
    await logAction({ user: req.user, action: 'IMPORT', entity: kind, details: JSON.stringify(summary), ip: req.ip });
    res.json(summary);
  } catch (e) { next(e); }
}
