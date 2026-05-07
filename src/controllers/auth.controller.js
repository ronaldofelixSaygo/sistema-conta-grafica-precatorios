import * as authSvc from '../services/auth.service.js';
import { env } from '../config/env.js';

export async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    const out = await authSvc.login({ email, password, ip: req.ip });
    // cookie httpOnly p/ web e o token também no body p/ apps externos
    res.cookie('token', out.token, {
      httpOnly: true,
      secure: env.isProd,
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.json(out);
  } catch (e) { next(e); }
}

export async function logout(req, res) {
  res.clearCookie('token');
  res.json({ ok: true });
}

export async function me(req, res) {
  res.json({ user: req.user });
}

export async function changePassword(req, res, next) {
  try {
    await authSvc.changePassword(req.user.id, req.body?.current, req.body?.next);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function setTheme(req, res, next) {
  try {
    const theme = req.body?.theme === 'light' ? 'light' : 'dark';
    const { prisma } = await import('../config/prisma.js');
    await prisma.user.update({ where: { id: req.user.id }, data: { themePref: theme } });
    res.json({ ok: true, theme });
  } catch (e) { next(e); }
}
