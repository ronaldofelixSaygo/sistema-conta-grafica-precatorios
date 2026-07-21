import * as sla from '../services/sla.service.js';
import { logAction } from '../services/audit.service.js';

export async function getConfig(req, res, next) {
  try { res.json(await sla.getConfig()); } catch (e) { next(e); }
}

export async function updateConfig(req, res, next) {
  try {
    const cfg = await sla.updateConfig(req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'sla_config', entityId: '1', ip: req.ip });
    res.json(cfg);
  } catch (e) { next(e); }
}

export async function listFeriados(req, res, next) {
  try { res.json(await sla.listFeriados()); } catch (e) { next(e); }
}

export async function createFeriado(req, res, next) {
  try {
    const f = await sla.createFeriado(req.body || {});
    await logAction({ user: req.user, action: 'CREATE', entity: 'feriado', entityId: String(f.id), details: f.nome, ip: req.ip });
    res.status(201).json(f);
  } catch (e) { next(e); }
}

export async function deleteFeriado(req, res, next) {
  try {
    await sla.deleteFeriado(req.params.id);
    await logAction({ user: req.user, action: 'DELETE', entity: 'feriado', entityId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
