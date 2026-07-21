import { prisma } from '../config/prisma.js';

// =====================================================================
// Regras de quem pode conversar com quem:
//  ADM     → todos
//  SAYGO   → todos
//  PARTNER → SAYGO/ADM
//            + Clientes do mesmo escritório (cliente.escritorio == officeName)
//            + Clientes em cujos cards do Kanban o parceiro está vinculado
//              (via parceiroId OU responsibleUserId)
//  CLIENT  → SAYGO/ADM
//            + Parceiros do seu escritório (officeName == cliente.escritorio)
//            + Parceiros vinculados a algum card do Kanban DO cliente
//              (via parceiroId OU responsibleUserId)
// =====================================================================

const BASE_SELECT = {
  id: true, name: true, apelido: true, email: true, role: true, officeName: true, clienteId: true,
  cliente: { select: { id: true, nome: true, escritorio: true } },
};

// Helper: pega usuários vinculados via Kanban (responsibleUser + parceiro do step)
// considerando todos os cards de um cliente OU um parceiro específico.
async function kanbanLinkedUserIds({ clienteId = null, parceiroId = null, userId = null }) {
  const where = {};
  if (clienteId) where.card = { clienteId };
  if (parceiroId || userId) {
    where.OR = [];
    if (parceiroId) where.OR.push({ parceiroId });
    if (userId)     where.OR.push({ responsibleUserId: userId });
    if (!where.OR.length) delete where.OR;
  }
  const stages = await prisma.kanbanStageProgress.findMany({
    where,
    select: {
      parceiroId: true, responsibleUserId: true,
      card: { select: { clienteId: true } },
    },
  });
  return stages;
}

export async function listContacts(currentUser) {
  const me = currentUser;
  if (!me) return [];

  if (me.role === 'ADM' || me.role === 'SAYGO') {
    return prisma.user.findMany({
      where: { active: true, NOT: { id: me.id } },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: BASE_SELECT,
    });
  }

  if (me.role === 'PARTNER') {
    const office = me.officeName;
    // Cards onde o parceiro está vinculado — direto (responsibleUserId=me.id)
    // ou indireto (parceiroId == User.parceiroId).
    const stages = await kanbanLinkedUserIds({ parceiroId: me.parceiroId || null, userId: me.id });
    const clienteIds = [...new Set(stages.map(s => s.card?.clienteId).filter(Boolean))];
    return prisma.user.findMany({
      where: {
        active: true,
        NOT: { id: me.id },
        OR: [
          { role: { in: ['ADM', 'SAYGO'] } },
          ...(office ? [{ role: 'CLIENT', cliente: { escritorio: office } }] : []),
          ...(clienteIds.length ? [{ role: 'CLIENT', clienteId: { in: clienteIds } }] : []),
        ],
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: BASE_SELECT,
    });
  }

  if (me.role === 'CLIENT') {
    // Isolamento por empresa: o cliente só enxerga parceiros ESTRUTURALMENTE
    // ligados à própria empresa — contabilidade, despachante, o escritório do
    // próprio cliente e os parceiros que atuam nos cards do Kanban DELE.
    // Nunca parceiros de outras operações.
    const myCli = me.clienteId ? await prisma.cliente.findUnique({
      where: { id: me.clienteId },
      select: { escritorio: true, contabilidadeId: true, despachanteId: true },
    }) : null;
    const office = (myCli?.escritorio || '').trim() || null;
    // Parceiros vinculados aos cards desse cliente.
    const stages = me.clienteId ? await kanbanLinkedUserIds({ clienteId: me.clienteId }) : [];
    const kanbanParceiroIds = stages.map(s => s.parceiroId).filter(Boolean);
    const responsibleIds    = [...new Set(stages.map(s => s.responsibleUserId).filter(Boolean))];
    // FK de contabilidade/despachante + parceiros dos cards do próprio cliente.
    const allowedParceiroIds = [...new Set([
      myCli?.contabilidadeId, myCli?.despachanteId, ...kanbanParceiroIds,
    ].filter(Boolean))];

    const or = [{ role: { in: ['ADM', 'SAYGO'] } }];
    if (allowedParceiroIds.length) or.push({ role: 'PARTNER', parceiroId: { in: allowedParceiroIds } });
    // Time do escritório do próprio cliente (match textual, agora case-insensitive)
    if (office) or.push({ role: 'PARTNER', officeName: { equals: office, mode: 'insensitive' } });
    // Usuários responsáveis diretos nos cards do cliente
    if (responsibleIds.length) or.push({ id: { in: responsibleIds } });

    return prisma.user.findMany({
      where: { active: true, NOT: { id: me.id }, OR: or },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: BASE_SELECT,
    });
  }

  return [];
}

export async function canChat(meUser, otherId) {
  if (!meUser || !otherId || meUser.id === otherId) return false;
  const list = await listContacts(meUser);
  return list.some(u => u.id === otherId);
}

function pairIds(a, b) {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

export async function getOrCreateConversation(userId, otherId) {
  const pair = pairIds(userId, otherId);
  const conv = await prisma.conversation.upsert({
    where: { userAId_userBId: pair },
    create: pair,
    update: {},
  });
  return conv;
}

export async function listConversations(userId) {
  const convs = await prisma.conversation.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    orderBy: [{ lastAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      userA: { select: { id: true, name: true, role: true } },
      userB: { select: { id: true, name: true, role: true } },
    },
  });
  return convs.map(c => {
    const other = c.userAId === userId ? c.userB : c.userA;
    return {
      id: c.id, otherId: other.id, otherName: other.name, otherRole: other.role,
      lastMessage: c.lastMessage, lastAt: c.lastAt,
    };
  });
}

export async function listMessages(userId, otherId, { limit = 100 } = {}) {
  if (!(await prisma.user.findUnique({ where: { id: otherId }, select: { id: true } })))
    return [];
  const conv = await getOrCreateConversation(userId, otherId);
  const msgs = await prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  // Marcar como lidas as mensagens recebidas
  await prisma.message.updateMany({
    where: { conversationId: conv.id, toUserId: userId, readAt: null },
    data: { readAt: new Date() },
  });
  return msgs;
}

export async function sendMessage(meUser, toUserId, content) {
  const text = (content || '').trim();
  if (!text) { const e = new Error('Mensagem vazia'); e.status = 400; throw e; }
  if (text.length > 5000) { const e = new Error('Mensagem muito longa'); e.status = 400; throw e; }
  if (!(await canChat(meUser, toUserId))) {
    const e = new Error('Você não pode conversar com este usuário'); e.status = 403; throw e;
  }
  const conv = await getOrCreateConversation(meUser.id, toUserId);
  const msg = await prisma.message.create({
    data: { conversationId: conv.id, fromUserId: meUser.id, toUserId, content: text },
  });
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessage: text.slice(0, 200), lastAt: new Date() },
  });
  return msg;
}

export async function unreadCount(userId) {
  return prisma.message.count({ where: { toUserId: userId, readAt: null } });
}
