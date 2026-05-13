import * as svc from '../services/clientes.service.js';
import { logAction } from '../services/audit.service.js';

export async function list(req, res, next) {
  try {
    // Desabilita cache HTTP — o front controla TTL próprio em memória.
    // Sem isso, o browser podia entregar lista antiga após cadastrar cliente.
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json(await svc.listClientes(req.user));
  } catch (e) { next(e); }
}

export async function get(req, res, next) {
  try {
    const c = await svc.getCliente(req.user, req.params.id);
    if (!c) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(c);
  } catch (e) { next(e); }
}

export async function create(req, res, next) {
  try {
    const c = await svc.createCliente(req.user, req.body || {});
    await logAction({ user: req.user, action: 'CREATE', entity: 'cliente', entityId: c.id, details: c.nome, ip: req.ip });
    res.status(201).json(c);
  } catch (e) { next(e); }
}

export async function update(req, res, next) {
  try {
    const c = await svc.updateCliente(req.user, req.params.id, req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'cliente', entityId: c.id, ip: req.ip });
    res.json(c);
  } catch (e) { next(e); }
}

export async function remove(req, res, next) {
  try {
    await svc.deleteCliente(req.user, req.params.id);
    await logAction({ user: req.user, action: 'DELETE', entity: 'cliente', entityId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function bulkComissao(req, res, next) {
  try {
    const r = await svc.bulkUpdateComissao(req.user, req.body || {});
    await logAction({ user: req.user, action: 'BULK_UPDATE', entity: 'cliente', details: `${r.count} clientes`, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}

export async function exportExcel(req, res, next) {
  try {
    await svc.exportClientesExcel(req.user, res);
    await logAction({ user: req.user, action: 'EXPORT', entity: 'cliente', details: 'excel', ip: req.ip });
  } catch (e) { next(e); }
}
