import * as svc from '../services/kanban.service.js';
import * as stageCfg from '../services/stageConfig.service.js';
import { logAction } from '../services/audit.service.js';
import { STAGES_ORDER } from '../utils/kanban.constants.js';

export async function meta(req, res, next) {
  try {
    const configs = await stageCfg.listConfigs();
    const stageMeta = {};
    for (const c of configs) {
      stageMeta[c.stage] = {
        label: c.label, slaHours: c.slaHours,
        responsibleRole: c.defaultResponsibleRole,
        defaultChecklist: (c.checklist || []).map(s =>
          typeof s === 'string' ? { label: s, done: false } : s
        ),
      };
    }
    res.json({ stagesOrder: STAGES_ORDER, stageMeta });
  } catch (e) { next(e); }
}

export async function listStageConfigs(req, res, next) {
  try { res.json(await stageCfg.listConfigs()); } catch (e) { next(e); }
}

export async function updateStageConfig(req, res, next) {
  try {
    const r = await stageCfg.updateConfig(req.params.stage, req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'kanban_stage_config', entityId: r.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}

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

export async function updateStage(req, res, next) {
  try {
    const sp = await svc.updateStage(req.user, req.params.id, req.params.stage, req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'kanban_stage', entityId: sp.id, ip: req.ip });
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
    const att = await svc.downloadAttachment(req.user, req.params.attId);
    res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.filename)}"`);
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
