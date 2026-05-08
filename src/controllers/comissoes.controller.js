import * as svc from '../services/comissoes.service.js';
import { logAction } from '../services/audit.service.js';

export async function simulate(req, res, next) {
  try { res.json(await svc.simulate(req.user, req.query)); } catch (e) { next(e); }
}
export async function listEscritorios(req, res, next) {
  try { res.json(await svc.listEscritorios(req.user)); } catch (e) { next(e); }
}
export async function listCommissions(req, res, next) {
  try { res.json(await svc.listCommissions(req.user)); } catch (e) { next(e); }
}
export async function generate(req, res, next) {
  try {
    const c = await svc.generateCommission(req.user, req.body || {});
    await logAction({ user: req.user, action: 'GENERATE', entity: 'commission', entityId: c.id, ip: req.ip });
    res.status(201).json(c);
  } catch (e) { next(e); }
}
export async function remove(req, res, next) {
  try {
    const r = await svc.deleteCommission(req.user, req.params.id);
    await logAction({ user: req.user, action: 'DELETE', entity: 'commission', entityId: req.params.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
export async function submit(req, res, next) {
  try {
    const c = await svc.submitCommission(req.user, req.params.id);
    await logAction({ user: req.user, action: 'SUBMIT', entity: 'commission', entityId: c.id, ip: req.ip });
    res.json(c);
  } catch (e) { next(e); }
}
export async function approve(req, res, next) {
  try {
    const c = await svc.approveCommission(req.user, req.params.id);
    await logAction({ user: req.user, action: 'APPROVE', entity: 'commission', entityId: c.id, ip: req.ip });
    res.json(c);
  } catch (e) { next(e); }
}
export async function reject(req, res, next) {
  try {
    const c = await svc.rejectCommission(req.user, req.params.id, req.body?.reason);
    await logAction({ user: req.user, action: 'REJECT', entity: 'commission', entityId: c.id, details: req.body?.reason, ip: req.ip });
    res.json(c);
  } catch (e) { next(e); }
}
export async function close(req, res, next) {
  try {
    const c = await svc.closeCommission(req.user, req.params.id);
    await logAction({ user: req.user, action: 'CLOSE', entity: 'commission', entityId: c.id, ip: req.ip });
    res.json(c);
  } catch (e) { next(e); }
}
export async function addExtra(req, res, next) {
  try {
    const r = await svc.addExtra(req.user, req.params.id, req.body || {});
    res.status(201).json(r);
  } catch (e) { next(e); }
}
export async function removeExtra(req, res, next) {
  try {
    res.json(await svc.removeExtra(req.user, req.params.extraId));
  } catch (e) { next(e); }
}
