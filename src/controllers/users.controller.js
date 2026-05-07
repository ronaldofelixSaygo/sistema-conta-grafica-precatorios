import * as usersSvc from '../services/users.service.js';
import { logAction } from '../services/audit.service.js';

export async function list(req, res, next) {
  try { res.json(await usersSvc.listUsers()); } catch (e) { next(e); }
}

export async function create(req, res, next) {
  try {
    const u = await usersSvc.createUser(req.body || {});
    await logAction({ user: req.user, action: 'CREATE', entity: 'user', entityId: u.id, details: u.email, ip: req.ip });
    res.status(201).json(u);
  } catch (e) { next(e); }
}

export async function update(req, res, next) {
  try {
    if (req.params.id === req.user.id && req.body?.role && req.body.role !== 'ADM') {
      const e = new Error('Você não pode rebaixar o próprio perfil de ADM'); e.status = 400; throw e;
    }
    const u = await usersSvc.updateUser(req.params.id, req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'user', entityId: u.id, ip: req.ip });
    res.json(u);
  } catch (e) { next(e); }
}

export async function deactivate(req, res, next) {
  try {
    if (req.params.id === req.user.id) {
      const e = new Error('Não pode desativar a própria conta'); e.status = 400; throw e;
    }
    const u = await usersSvc.deactivateUser(req.params.id);
    await logAction({ user: req.user, action: 'DEACTIVATE', entity: 'user', entityId: u.id, ip: req.ip });
    res.json(u);
  } catch (e) { next(e); }
}

export async function remove(req, res, next) {
  try {
    if (req.params.id === req.user.id) {
      const e = new Error('Não pode excluir a própria conta'); e.status = 400; throw e;
    }
    await usersSvc.deleteUser(req.params.id);
    await logAction({ user: req.user, action: 'DELETE', entity: 'user', entityId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
