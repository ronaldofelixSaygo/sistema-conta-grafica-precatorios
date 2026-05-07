import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { signToken } from '../utils/jwt.js';
import { logAction } from './audit.service.js';

export async function login({ email, password, ip }) {
  const e = (email || '').trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: e } });
  if (!user || !user.active) {
    const err = new Error('E-mail ou senha inválidos');
    err.status = 401; throw err;
  }
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) {
    const err = new Error('E-mail ou senha inválidos');
    err.status = 401; throw err;
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await logAction({ user, action: 'LOGIN', ip });

  const token = signToken({ uid: user.id, role: user.role });
  return {
    token,
    user: {
      id: user.id, email: user.email, name: user.name, role: user.role,
      officeName: user.officeName, clienteId: user.clienteId,
    },
  };
}

export async function changePassword(userId, current, next) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) { const e = new Error('Usuário não encontrado'); e.status = 404; throw e; }
  if (!(await bcrypt.compare(current || '', user.passwordHash))) {
    const e = new Error('Senha atual incorreta'); e.status = 400; throw e;
  }
  if (!next || next.length < 6) {
    const e = new Error('Nova senha deve ter no mínimo 6 caracteres'); e.status = 400; throw e;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(next, 10) },
  });
}
