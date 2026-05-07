import * as svc from '../services/partnerRequest.service.js';
import { logAction } from '../services/audit.service.js';

export async function create(req, res, next) {
  try {
    const r = await svc.createRequest(req.user, req.body || {});
    await logAction({ user: req.user, action: 'CREATE', entity: 'partner_request', entityId: r.id, ip: req.ip });
    res.status(201).json(r);
  } catch (e) { next(e); }
}

export async function list(req, res, next) {
  try { res.json(await svc.listRequests(req.user, req.query)); } catch (e) { next(e); }
}

export async function get(req, res, next) {
  try { res.json(await svc.getRequest(req.user, req.params.id)); } catch (e) { next(e); }
}

export async function update(req, res, next) {
  try {
    const r = await svc.updateRequest(req.user, req.params.id, req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'partner_request', entityId: r.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
