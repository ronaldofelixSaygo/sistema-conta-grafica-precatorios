import { prisma } from '../config/prisma.js';
import { clienteScope } from '../utils/scope.js';

// Cria uma solicitação direcionada ao parceiro do cliente.
// Apenas CLIENT (do próprio cliente) ou Saygo/Adm pode criar.
export async function createRequest(user, { clienteId, type, payload, message }) {
  if (!type) { const e = new Error('type é obrigatório'); e.status = 400; throw e; }
  const cli = await prisma.cliente.findFirst({
    where: { id: Number(clienteId), ...clienteScope(user) },
  });
  if (!cli) { const e = new Error('Cliente não encontrado'); e.status = 404; throw e; }
  if (!cli.escritorio) { const e = new Error('Cliente não tem escritório/parceiro definido'); e.status = 400; throw e; }

  // Só o próprio cliente, ou Saygo/Adm, pode acionar (Parceiros não criam, eles RECEBEM)
  const allowed = user.role === 'ADM' || user.role === 'SAYGO' ||
                  (user.role === 'CLIENT' && user.clienteId === cli.id);
  if (!allowed) { const e = new Error('Sem permissão'); e.status = 403; throw e; }

  return prisma.partnerRequest.create({
    data: {
      clienteId: cli.id,
      type,
      payload: payload || {},
      message: message || null,
      requestedById: user.id,
      partnerOfficeName: cli.escritorio,
    },
  });
}

// Lista as solicitações visíveis para o usuário
export async function listRequests(user, { status } = {}) {
  let where = {};
  if (user.role === 'PARTNER') {
    where = { partnerOfficeName: user.officeName || '__none__' };
  } else if (user.role === 'CLIENT') {
    where = { clienteId: user.clienteId || -1 };
  }
  if (status) where.status = status;

  return prisma.partnerRequest.findMany({
    where,
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true } },
      requestedBy: { select: { id: true, name: true, role: true } },
      resolvedBy:  { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateRequest(user, id, { status, message }) {
  const reqRow = await prisma.partnerRequest.findUnique({ where: { id } });
  if (!reqRow) { const e = new Error('Solicitação não encontrada'); e.status = 404; throw e; }

  // Quem pode atualizar: Saygo/Adm sempre; Parceiro do escritório-alvo
  const isStaff   = user.role === 'ADM' || user.role === 'SAYGO';
  const isPartner = user.role === 'PARTNER' && reqRow.partnerOfficeName === user.officeName;
  if (!isStaff && !isPartner) { const e = new Error('Sem permissão'); e.status = 403; throw e; }

  const data = {};
  if (message !== undefined) data.message = message || null;
  if (status  !== undefined) {
    data.status = status;
    if (status === 'RESOLVED' || status === 'CANCELED') {
      data.resolvedAt = new Date();
      data.resolvedById = user.id;
    }
  }
  return prisma.partnerRequest.update({ where: { id }, data });
}

export async function getRequest(user, id) {
  const r = await prisma.partnerRequest.findUnique({
    where: { id },
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true } },
      requestedBy: { select: { id: true, name: true, role: true } },
      resolvedBy:  { select: { id: true, name: true } },
    },
  });
  if (!r) { const e = new Error('Solicitação não encontrada'); e.status = 404; throw e; }
  // scope check
  if (user.role === 'PARTNER' && r.partnerOfficeName !== user.officeName) {
    const e = new Error('Sem permissão'); e.status = 403; throw e;
  }
  if (user.role === 'CLIENT' && r.clienteId !== user.clienteId) {
    const e = new Error('Sem permissão'); e.status = 403; throw e;
  }
  return r;
}
