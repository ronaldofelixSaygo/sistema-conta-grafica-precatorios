import * as svc from '../services/desoneracoes.service.js';
import { logAction } from '../services/audit.service.js';

export async function list(req, res, next) {
  try { res.json(await svc.listDesoneracoes(req.user, req.query || {})); } catch (e) { next(e); }
}
export async function get(req, res, next) {
  try { res.json(await svc.getDesoneracao(req.params.id, req.user)); } catch (e) { next(e); }
}
// Cache curto pra endpoints semi-estáticos: front pode reusar por 60s sem
// ir no servidor, e mesmo se for, o ETag/304 corta a maior parte do payload.
function setShortCache(res, seconds = 60) {
  res.set('Cache-Control', `private, max-age=${seconds}, stale-while-revalidate=30`);
}

export async function listStepConfigs(_req, res, next) {
  try { setShortCache(res, 120); res.json(await svc.listStepConfigs()); } catch (e) { next(e); }
}
export async function upsertStepConfig(req, res, next) {
  try { res.json(await svc.upsertStepConfig(req.body || {})); } catch (e) { next(e); }
}
export async function listDocTipos(req, res, next) {
  try {
    setShortCache(res, 120);
    res.json(await svc.listDocTipos({ includeInactive: req.query.all === '1' }));
  } catch (e) { next(e); }
}
export async function upsertDocTipo(req, res, next) {
  try {
    const body = { ...(req.body || {}), id: req.params.id || req.body?.id };
    res.json(await svc.upsertDocTipo(body));
  } catch (e) { next(e); }
}
export async function deleteDocTipo(req, res, next) {
  try { res.json(await svc.deleteDocTipo(req.params.id)); } catch (e) { next(e); }
}
export async function create(req, res, next) {
  try {
    const r = await svc.createDesoneracao(req.user, req.body || {});
    await logAction({ user: req.user, action: 'CREATE', entity: 'desoneracao', entityId: r.id, ip: req.ip });
    res.status(201).json(r);
  } catch (e) { next(e); }
}
export async function update(req, res, next) {
  try {
    const r = await svc.updateDesoneracao(req.user, req.params.id, req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'desoneracao', entityId: r.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
export async function setStepParceiro(req, res, next) {
  try {
    const r = await svc.setStepParceiro(req.user, req.params.id, req.params.etapa, req.body?.parceiroId);
    res.json(r);
  } catch (e) { next(e); }
}
export async function advance(req, res, next) {
  try {
    const r = await svc.advanceStep(req.user, req.params.id, req.body || {});
    await logAction({ user: req.user, action: 'ADVANCE_STEP', entity: 'desoneracao', entityId: req.params.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
export async function approve(req, res, next) {
  try {
    const r = await svc.approveAndCreateMovimentacao(req.user, req.params.id);
    await logAction({ user: req.user, action: 'APPROVE', entity: 'desoneracao', entityId: req.params.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
export async function cancel(req, res, next) {
  try {
    const r = await svc.cancelDesoneracao(req.user, req.params.id, req.body?.reason);
    await logAction({ user: req.user, action: 'CANCEL', entity: 'desoneracao', entityId: req.params.id, details: req.body?.reason, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}

// === Notas ===
export async function addNota(req, res, next) {
  try { res.status(201).json(await svc.addNota(req.user, req.params.id, req.body || {})); } catch (e) { next(e); }
}
export async function validarNota(req, res, next) {
  try { res.json(await svc.validarNota(req.user, req.params.notaId)); } catch (e) { next(e); }
}
export async function rejeitarNota(req, res, next) {
  try { res.json(await svc.rejeitarNota(req.user, req.params.notaId, req.body?.motivo)); } catch (e) { next(e); }
}
export async function anexarOficial(req, res, next) {
  try {
    if (!req.file) { const e = new Error('Arquivo obrigatório'); e.status = 400; throw e; }
    res.json(await svc.anexarOficialNota(req.user, req.params.notaId, {
      name: req.file.originalname, mime: req.file.mimetype, bytes: req.file.buffer,
    }));
  } catch (e) { next(e); }
}
export async function downloadOficial(req, res, next) {
  try {
    const { name, mime, bytes } = await svc.getOficialNota(req.params.notaId);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    res.end(Buffer.from(bytes));
  } catch (e) { next(e); }
}
export async function removeNota(req, res, next) {
  try { res.json(await svc.removeNota(req.user, req.params.notaId)); } catch (e) { next(e); }
}
export async function uploadNota(req, res, next) {
  try { res.status(201).json(await svc.uploadNota(req.user, req.params.id, req.file, req.body?.tipo)); } catch (e) { next(e); }
}
export async function devolverNfs(req, res, next) {
  try { res.json(await svc.devolverNfsCliente(req.user, req.params.id)); } catch (e) { next(e); }
}

// === Documentos ===
export async function addDocumento(req, res, next) {
  try {
    if (!req.file) { const e = new Error('Arquivo obrigatório'); e.status = 400; throw e; }
    res.status(201).json(await svc.addDocumento(req.user, req.params.id, {
      tipo: req.body?.tipo || 'OUTRO',
      name: req.file.originalname, mime: req.file.mimetype, bytes: req.file.buffer,
    }));
  } catch (e) { next(e); }
}
export async function downloadDoc(req, res, next) {
  try {
    const { name, mime, bytes } = await svc.getDocumento(req.params.docId);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    res.end(Buffer.from(bytes));
  } catch (e) { next(e); }
}
export async function removeDoc(req, res, next) {
  try { res.json(await svc.removeDocumento(req.user, req.params.docId)); } catch (e) { next(e); }
}

// === Config (Parâmetros) ===
export async function listDocConfigs(_req, res, next) {
  try { res.json(await svc.listDocConfigs()); } catch (e) { next(e); }
}
export async function upsertDocConfig(req, res, next) {
  try { res.json(await svc.upsertDocConfig(req.body || {})); } catch (e) { next(e); }
}
export async function removeDocConfig(req, res, next) {
  try { res.json(await svc.removeDocConfig(req.params.id)); } catch (e) { next(e); }
}

export async function getRequiredDocsForUI(req, res, next) {
  try { res.json(await svc.getRequiredDocsForUI(req.query.modal || 'MARITIMO')); } catch (e) { next(e); }
}

export async function meta(_req, res) { res.json(svc.META); }
