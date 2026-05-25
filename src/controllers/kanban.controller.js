import * as svc from '../services/kanban.service.js';
import * as stageDef from '../services/stageDef.service.js';
import { logAction } from '../services/audit.service.js';

// META: lista etapas ATIVAS (para o board) com formato amigavel ao frontend
export async function meta(req, res, next) {
  try {
    const stages = await stageDef.listActive();
    const stagesOrder = stages.map(s => s.key);
    const stageMeta = {};
    for (const s of stages) {
      stageMeta[s.key] = {
        label: s.label, slaHours: s.slaHours,
        responsibleRole: s.defaultResponsibleRole,
        isFinal: s.isFinal,
      };
    }
    res.json({ stagesOrder, stageMeta });
  } catch (e) { next(e); }
}

// === ETAPAS (CRUD) ===
export async function listStages(req, res, next) {
  try { res.json(await stageDef.listAll()); } catch (e) { next(e); }
}
export async function createStageCfg(req, res, next) {
  try {
    const r = await stageDef.createStage(req.body || {});
    await logAction({ user: req.user, action: 'CREATE', entity: 'kanban_stage_def', entityId: r.id, ip: req.ip });
    res.status(201).json(r);
  } catch (e) { next(e); }
}
export async function updateStageCfg(req, res, next) {
  try {
    const r = await stageDef.updateStage(req.params.id, req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'kanban_stage_def', entityId: r.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
export async function deleteStageCfg(req, res, next) {
  try {
    await stageDef.deleteStage(req.params.id);
    await logAction({ user: req.user, action: 'DELETE', entity: 'kanban_stage_def', entityId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// === ATIVIDADES ===
export async function createActivity(req, res, next) {
  try {
    const r = await stageDef.createActivity(req.params.stageId, req.body || {});
    await logAction({ user: req.user, action: 'CREATE', entity: 'kanban_activity_def', entityId: r.id, ip: req.ip });
    res.status(201).json(r);
  } catch (e) { next(e); }
}
export async function updateActivity(req, res, next) {
  try {
    const r = await stageDef.updateActivity(req.params.id, req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'kanban_activity_def', entityId: r.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
export async function deleteActivity(req, res, next) {
  try {
    await stageDef.deleteActivity(req.params.id);
    await logAction({ user: req.user, action: 'DELETE', entity: 'kanban_activity_def', entityId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// === CARDS ===
export async function listCards(req, res, next) {
  try { res.json(await svc.listCards(req.user)); } catch (e) { next(e); }
}
export async function createCard(req, res, next) {
  try {
    const c = await svc.createCard(req.user, req.body || {});
    await logAction({ user: req.user, action: 'CREATE', entity: 'kanban_card', entityId: c.id, ip: req.ip });
    res.status(201).json(c);
  } catch (e) { next(e); }
}
export async function getCard(req, res, next) {
  try { res.json(await svc.getCard(req.user, req.params.id)); } catch (e) { next(e); }
}
export async function updateStageProgress(req, res, next) {
  try {
    const sp = await svc.updateStage(req.user, req.params.id, req.params.stage, req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'kanban_stage_progress', entityId: sp.id, ip: req.ip });
    res.json(sp);
  } catch (e) { next(e); }
}
export async function completeStage(req, res, next) {
  try {
    const force = req.body?.force === true || req.query?.force === 'true';
    const r = await svc.completeStage(req.user, req.params.id, req.params.stage, { force });
    await logAction({ user: req.user, action: 'COMPLETE_STAGE', entity: 'kanban_card',
                     entityId: req.params.id, details: req.params.stage + (force ? ' (forced)' : ''), ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
export async function moveCard(req, res, next) {
  try {
    const r = await svc.moveCard(req.user, req.params.id, req.body?.toStage);
    await logAction({ user: req.user, action: 'MOVE_CARD', entity: 'kanban_card',
                     entityId: req.params.id, details: req.body?.toStage, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
export async function uploadAttachment(req, res, next) {
  try {
    const a = await svc.uploadAttachment(req.user, req.params.id, req.file, {
      stageProgressId: req.body?.stageProgressId,
    });
    await logAction({ user: req.user, action: 'UPLOAD', entity: 'kanban_attachment', entityId: a.id, ip: req.ip });
    res.status(201).json(a);
  } catch (e) { next(e); }
}
export async function downloadAttachment(req, res, next) {
  try {
    const download = req.query.download === '1' || req.query.download === 'true';
    const att = await svc.downloadAttachment(req.user, req.params.attId, { download });
    // S3: redirect 302 pra URL assinada (zero peso no servidor)
    if (att.redirectUrl) return res.redirect(att.redirectUrl);
    // Legado: bytes inline
    const disposition = att._inline === false ? 'attachment' : 'inline';
    res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(att.filename)}"`);
    res.setHeader('Content-Length', att.size);
    res.end(Buffer.from(att.content));
  } catch (e) { next(e); }
}
export async function deleteAttachment(req, res, next) {
  try {
    const r = await svc.deleteAttachment(req.user, req.params.attId);
    await logAction({ user: req.user, action: 'DELETE', entity: 'kanban_attachment', entityId: req.params.attId, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
