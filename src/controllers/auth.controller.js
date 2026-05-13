import * as authSvc from '../services/auth.service.js';
import { env } from '../config/env.js';
import { effectivePerms } from '../services/permissions.service.js';

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

export async function me(req, res, next) {
  try {
    const perms = await effectivePerms(req.user);
    res.json({ user: req.user, perms });
  } catch (e) { next(e); }
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

// Avatar (foto de perfil). Bytes guardados na própria tabela User. Limitado
// a 2 MB pra não inflar payload de listagens. Mime aceito: png|jpg|jpeg|webp.
const AVATAR_MAX = 2 * 1024 * 1024;
const AVATAR_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export async function uploadAvatar(req, res, next) {
  try {
    if (!req.file) { const e = new Error('Arquivo não enviado'); e.status = 400; throw e; }
    if (req.file.size > AVATAR_MAX) {
      const e = new Error(`Foto muito grande (máx ${AVATAR_MAX/1024/1024}MB)`); e.status = 400; throw e;
    }
    if (!AVATAR_MIMES.has(req.file.mimetype)) {
      const e = new Error('Formato não suportado (use PNG, JPG ou WEBP)'); e.status = 400; throw e;
    }
    const { prisma } = await import('../config/prisma.js');
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        avatarBytes: req.file.buffer,
        avatarMime: req.file.mimetype,
        avatarUpdated: new Date(),
      },
    });
    res.json({ ok: true, updatedAt: new Date() });
  } catch (e) { next(e); }
}

export async function deleteAvatar(req, res, next) {
  try {
    const { prisma } = await import('../config/prisma.js');
    await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarBytes: null, avatarMime: null, avatarUpdated: new Date() },
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// Serve a foto. Disponível pra todos os usuários autenticados ver avatares dos
// outros (chat, lista de usuários, etc). Cache por 1h, busted pelo ?v=timestamp
// que o frontend adiciona.
export async function getAvatar(req, res, next) {
  try {
    const { prisma } = await import('../config/prisma.js');
    const u = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { avatarBytes: true, avatarMime: true },
    });
    if (!u?.avatarBytes) { res.status(404).end(); return; }
    res.setHeader('Content-Type', u.avatarMime || 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(u.avatarBytes));
  } catch (e) { next(e); }
}
