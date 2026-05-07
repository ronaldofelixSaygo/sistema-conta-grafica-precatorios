import * as svc from '../services/parceiros.service.js';
import { logAction } from '../services/audit.service.js';

export async function list(req, res, next) {
  try { res.json(await svc.listParceiros(req.query)); } catch (e) { next(e); }
}
export async function create(req, res, next) {
  try {
    const p = await svc.createParceiro(req.body || {});
    await logAction({ user: req.user, action:'CREATE', entity:'parceiro', entityId:p.id, ip:req.ip });
    res.status(201).json(p);
  } catch (e) { next(e); }
}
export async function update(req, res, next) {
  try {
    const p = await svc.updateParceiro(req.params.id, req.body || {});
    await logAction({ user: req.user, action:'UPDATE', entity:'parceiro', entityId:p.id, ip:req.ip });
    res.json(p);
  } catch (e) { next(e); }
}
export async function remove(req, res, next) {
  try {
    await svc.deleteParceiro(req.params.id);
    await logAction({ user: req.user, action:'DELETE', entity:'parceiro', entityId:req.params.id, ip:req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
