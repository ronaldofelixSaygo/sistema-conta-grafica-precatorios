// =====================================================================
// Socket.IO — chat em tempo real.
// =====================================================================
import { authenticateSocket } from '../middlewares/auth.middleware.js';
import * as chat from '../services/chat.service.js';
import * as email from '../services/email.service.js';
import { prisma } from '../config/prisma.js';

function parseCookieHeader(h) {
  const out = {};
  if (!h) return out;
  for (const part of String(h).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); }
    catch { out[k] = v; }
  }
  return out;
}

export function bindChatSockets(io) {
  // ── auth handshake ────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      let token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        '';
      if (!token) {
        const cookies = parseCookieHeader(socket.handshake.headers?.cookie);
        if (cookies.token) token = cookies.token;
      }
      if (!token) {
        console.warn('[socket] sem token no handshake');
        return next(new Error('unauthorized: no token'));
      }
      const user = await authenticateSocket(token);
      if (!user || !user.active) {
        console.warn('[socket] token invalido ou user inativo');
        return next(new Error('unauthorized: invalid'));
      }
      socket.user = user;
      next();
    } catch (e) {
      console.error('[socket] erro auth:', e.message);
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.user;
    socket.join(`user:${me.id}`);
    console.log(`[socket] conectado: ${me.email}`);

    const emitToPair = (event, payload, otherId) => {
      io.to(`user:${me.id}`).emit(event, payload);
      io.to(`user:${otherId}`).emit(event, payload);
    };

    socket.on('chat:send', async ({ toUserId, content }, ack) => {
      try {
        const msg = await chat.sendMessage(me, toUserId, content);
        emitToPair('chat:message', msg, toUserId);
        if (typeof ack === 'function') ack({ ok: true, message: msg });
        // E-mail imediato pro destinatário (fire-and-forget). Cron de
        // re-notificação cuida das mensagens que continuarem sem leitura.
        // Pequeno delay de 5s permite que se o destinatário ler na hora
        // (socket marca readAt), a gente cancela o envio inicial.
        setTimeout(async () => {
          try {
            const m = await prisma.message.findUnique({
              where: { id: msg.id },
              select: { id: true, content: true, readAt: true, lastChatNotifiedAt: true },
            });
            if (!m || m.readAt) return; // já leu — não notifica
            const to = await prisma.user.findUnique({
              where: { id: toUserId }, select: { id: true, email: true, name: true, active: true, receberEmails: true },
            });
            if (!to?.active || !to.email) return;
            await email.notifyChatMessage({
              messageId: msg.id, fromUser: me, toUser: to, content: m.content,
            });
            await prisma.message.update({ where: { id: msg.id }, data: { lastChatNotifiedAt: new Date() } });
          } catch (e) { console.error('[socket] chat notify imediato falhou:', e.message); }
        }, 5000);
      } catch (e) {
        console.error('[socket] chat:send erro:', e.message);
        if (typeof ack === 'function') ack({ ok: false, error: e.message });
      }
    });

    socket.on('chat:read', async ({ otherId }, ack) => {
      try {
        await chat.listMessages(me.id, otherId, { limit: 1 });
        emitToPair('chat:read', { byUserId: me.id, otherId }, otherId);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (e) {
        if (typeof ack === 'function') ack({ ok: false, error: e.message });
      }
    });

    io.emit('chat:presence', { userId: me.id, online: true });
    socket.on('disconnect', () => {
      io.emit('chat:presence', { userId: me.id, online: false });
    });

    socket.on('chat:typing', ({ toUserId, typing }) => {
      io.to(`user:${toUserId}`).emit('chat:typing', { fromUserId: me.id, typing: !!typing });
    });
  });
}
