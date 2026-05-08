import * as svc from '../services/movimentacoes.service.js';
import * as extrato from '../services/extratoPdf.service.js';
import { logAction } from '../services/audit.service.js';

export async function list(req, res, next) {
  try { res.json(await svc.listMovimentacoes(req.user, req.query)); } catch (e) { next(e); }
}

export async function create(req, res, next) {
  try {
    const m = await svc.createMovimentacao(req.user, req.body || {});
    await logAction({ user: req.user, action: 'CREATE', entity: 'movimentacao', entityId: m.id, ip: req.ip });
    res.status(201).json(m);
  } catch (e) { next(e); }
}

export async function update(req, res, next) {
  try {
    const m = await svc.updateMovimentacao(req.user, req.params.id, req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'movimentacao', entityId: m.id, ip: req.ip });
    res.json(m);
  } catch (e) { next(e); }
}

export async function remove(req, res, next) {
  try {
    await svc.deleteMovimentacao(req.user, req.params.id);
    await logAction({ user: req.user, action: 'DELETE', entity: 'movimentacao', entityId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function importExtratoPreview(req, res, next) {
  try {
    if (!req.file) { const e = new Error('Arquivo PDF nao enviado'); e.status = 400; throw e; }
    const r = await extrato.previewExtrato(req.file.buffer);
    res.json(r);
  } catch (e) { next(e); }
}

export async function importExtratoApply(req, res, next) {
  try {
    const { items, cliente_id } = req.body || {};
    const r = await extrato.applyExtrato(items, cliente_id);
    await logAction({ user: req.user, action: 'IMPORT_EXTRATO', entity: 'movimentacao', details: `${r.created} criados`, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
