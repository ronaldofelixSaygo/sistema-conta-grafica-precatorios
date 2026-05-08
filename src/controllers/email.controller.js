import * as svc from '../services/email.service.js';
import { prisma } from '../config/prisma.js';
import { logAction } from '../services/audit.service.js';

export async function getSettings(req, res, next) {
  try { res.json(await svc.getSettingsSafe()); } catch (e) { next(e); }
}
export async function updateSettings(req, res, next) {
  try {
    const r = await svc.updateSettings(req.body || {});
    await logAction({ user: req.user, action: 'UPDATE', entity: 'email_settings', ip: req.ip });
    res.json({ ...r, pass: r.pass ? '***' : '' });
  } catch (e) { next(e); }
}
export async function testMail(req, res, next) {
  try {
    const to = req.body?.to || req.user.email;
    await svc.sendTestMail(to);
    res.json({ ok: true, to });
  } catch (e) { next(e); }
}
export async function listLogs(req, res, next) {
  try {
    const items = await prisma.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    res.json(items);
  } catch (e) { next(e); }
}
