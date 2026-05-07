import * as chat from '../services/chat.service.js';

export async function contacts(req, res, next) {
  try { res.json(await chat.listContacts(req.user)); } catch (e) { next(e); }
}
export async function conversations(req, res, next) {
  try { res.json(await chat.listConversations(req.user.id)); } catch (e) { next(e); }
}
export async function messages(req, res, next) {
  try { res.json(await chat.listMessages(req.user.id, req.params.otherId)); } catch (e) { next(e); }
}
export async function send(req, res, next) {
  try {
    const m = await chat.sendMessage(req.user, req.params.otherId, req.body?.content);
    res.status(201).json(m);
  } catch (e) { next(e); }
}
export async function unread(req, res, next) {
  try { res.json({ count: await chat.unreadCount(req.user.id) }); } catch (e) { next(e); }
}
