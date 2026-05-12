import * as svc from '../services/permissions.service.js';
import { logAction } from '../services/audit.service.js';

export async function list(req, res, next) {
  try {
    const [items, profiles] = await Promise.all([
      svc.listAll(),
      svc.listProfiles(),
    ]);
    res.json({ items, meta: { ...svc.META, PROFILES: profiles } });
  } catch (e) { next(e); }
}

export async function update(req, res, next) {
  try {
    const r = await svc.update(req.params.id, req.body || {});
    await logAction({ user: req.user, action:'UPDATE', entity:'role_permission', entityId:r.id, ip:req.ip });
    res.json(r);
  } catch (e) { next(e); }
}

export async function reset(req, res, next) {
  try {
    await svc.resetToDefaults();
    await logAction({ user: req.user, action:'RESET', entity:'role_permission', ip:req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
