import * as svc from '../services/partnerKind.service.js';
import { logAction } from '../services/audit.service.js';

export async function list(req, res, next) {
  try { res.json(await svc.listAll()); } catch (e) { next(e); }
}

// Endpoint público (usado por qualquer usuário autenticado pra popular dropdowns)
export async function listActive(req, res, next) {
  try { res.json(await svc.listActive()); } catch (e) { next(e); }
}

export async function create(req, res, next) {
  try {
    const r = await svc.create(req.body || {});
    await logAction({ user: req.user, action: 'CREATE', entity: 'partner_kind', entityId: r.id, details: r.code, ip: req.ip });
    res.status(201).json(r);
  } catch (e) { next(e); }
}

export async function update(req, res, next) {
  try {
    const r = await svc.update(req.params.id, req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'partner_kind', entityId: r.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}

export async function remove(req, res, next) {
  try {
    await svc.remove(req.params.id);
    await logAction({ user: req.user, action: 'DELETE', entity: 'partner_kind', entityId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
