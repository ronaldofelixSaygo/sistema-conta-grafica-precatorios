import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';

const VALID_ROLES = ['ADM', 'SAYGO', 'PARTNER', 'CLIENT'];

const userPublicSelect = {
  id: true, email: true, name: true, role: true, active: true,
  officeName: true, clienteId: true, lastLoginAt: true, createdAt: true,
  cliente: { select: { id: true, nome: true, escritorio: true } },
};

export async function listUsers() {
  return prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: userPublicSelect,
  });
}

export async function createUser(input) {
  const { email, password, name, role, officeName, clienteId } = input;
  if (!email || !password || !name || !role) {
    const e = new Error('Campos obrigatórios: email, password, name, role'); e.status = 400; throw e;
  }
  if (!VALID_ROLES.includes(role)) {
    const e = new Error('role inválido'); e.status = 400; throw e;
  }
  if (password.length < 6) {
    const e = new Error('Senha mínima 6 caracteres'); e.status = 400; throw e;
  }
  if (role === 'PARTNER' && !officeName) {
    const e = new Error('Para PARTNER, informe officeName (escritório)'); e.status = 400; throw e;
  }
  if (role === 'CLIENT' && !clienteId) {
    const e = new Error('Para CLIENT, informe clienteId'); e.status = 400; throw e;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: {
      email: email.trim().toLowerCase(),
      passwordHash, name, role,
      officeName: officeName || null,
      clienteId: clienteId ? Number(clienteId) : null,
    },
    select: userPublicSelect,
  });
}

export async function updateUser(id, input) {
  const data = {};
  if (input.name !== undefined)        data.name = input.name;
  if (input.role !== undefined) {
    if (!VALID_ROLES.includes(input.role)) { const e=new Error('role inválido'); e.status=400; throw e; }
    data.role = input.role;
  }
  if (input.officeName !== undefined)  data.officeName  = input.officeName || null;
  if (input.clienteId  !== undefined)  data.clienteId   = input.clienteId  ? Number(input.clienteId) : null;
  if (input.active     !== undefined)  data.active      = !!input.active;
  if (input.password) {
    if (input.password.length < 6) { const e=new Error('Senha mínima 6 caracteres'); e.status=400; throw e; }
    data.passwordHash = await bcrypt.hash(input.password, 10);
  }
  return prisma.user.update({ where: { id }, data, select: userPublicSelect });
}

export async function deactivateUser(id) {
  return prisma.user.update({ where: { id }, data: { active: false }, select: userPublicSelect });
}

export async function deleteUser(id) {
  return prisma.user.delete({ where: { id } });
}
