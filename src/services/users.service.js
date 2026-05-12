import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';

const VALID_ROLES = ['ADM', 'SAYGO', 'PARTNER', 'CLIENT'];

const userPublicSelect = {
  id: true, email: true, name: true, role: true, active: true,
  officeName: true, clienteId: true, parceiroId: true, lastLoginAt: true, createdAt: true,
  cliente: { select: { id: true, nome: true, escritorio: true } },
  parceiro: { select: { id: true, nome: true, type: true } },
};

export async function listUsers() {
  return prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: userPublicSelect,
  });
}

export async function createUser(input) {
  const { email, password, name, role, officeName, clienteId, parceiroId } = input;
  if (!email || !password || !name || !role) {
    const e = new Error('Campos obrigatórios: email, password, name, role'); e.status = 400; throw e;
  }
  if (!VALID_ROLES.includes(role)) {
    const e = new Error('role inválido'); e.status = 400; throw e;
  }
  if (password.length < 6) {
    const e = new Error('Senha mínima 6 caracteres'); e.status = 400; throw e;
  }
  if (role === 'PARTNER' && !parceiroId) {
    const e = new Error('Para PARTNER, vincule um Parceiro (cadastro)'); e.status = 400; throw e;
  }
  if (role === 'CLIENT' && !clienteId) {
    const e = new Error('Para CLIENT, informe clienteId'); e.status = 400; throw e;
  }

  // Checa duplicidade de e-mail antes de chamar o Prisma (mensagem melhor)
  const emailNorm = String(email).trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: emailNorm }, select: { id: true, active: true } });
  if (existing) {
    const e = new Error(existing.active
      ? `Já existe um usuário ativo com o e-mail ${emailNorm}.`
      : `Já existe um usuário (inativo) com o e-mail ${emailNorm}. Reative em vez de criar.`);
    e.status = 409; throw e;
  }

  // Se PARTNER, deriva officeName do nome do parceiro (se nao fornecido)
  let finalOfficeName = officeName || null;
  if (role === 'PARTNER' && parceiroId) {
    const parc = await prisma.parceiro.findUnique({ where: { id: parceiroId } });
    if (!parc) { const e = new Error('Parceiro nao encontrado'); e.status = 400; throw e; }
    if (!finalOfficeName) finalOfficeName = parc.nome;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: {
      email: emailNorm,
      passwordHash, name, role,
      officeName: finalOfficeName,
      clienteId: clienteId ? Number(clienteId) : null,
      parceiroId: parceiroId || null,
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
  if (input.parceiroId !== undefined)  data.parceiroId  = input.parceiroId || null;
  if (input.active     !== undefined)  data.active      = !!input.active;
  if (input.password) {
    if (input.password.length < 6) { const e=new Error('Senha mínima 6 caracteres'); e.status=400; throw e; }
    data.passwordHash = await bcrypt.hash(input.password, 10);
  }

  // Limpa vínculos que não fazem sentido para o role final
  // (mesmo que o frontend não tenha mandado, garante consistência no banco)
  let finalRole = data.role;
  if (finalRole === undefined) {
    const cur = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    finalRole = cur?.role;
  }
  if (finalRole && finalRole !== 'PARTNER') {
    data.parceiroId = null;
    data.officeName = null;
  }
  if (finalRole && finalRole !== 'CLIENT') {
    data.clienteId = null;
  }

  return prisma.user.update({ where: { id }, data, select: userPublicSelect });
}

export async function deactivateUser(id) {
  return prisma.user.update({ where: { id }, data: { active: false }, select: userPublicSelect });
}

export async function deleteUser(id) {
  return prisma.user.delete({ where: { id } });
}
