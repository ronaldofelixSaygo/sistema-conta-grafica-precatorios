// =====================================================================
// Socket.IO — chat em tempo real.
// Cada usuário entra em uma "sala" privada `user:<id>`. Ao enviar uma
// mensagem, o backend persiste em Neon (chat.service.sendMessage) e
// emite "message:new" para o destinatário e para o remetente.
// =====================================================================
import { authenticateSocket } from '../middlewares/auth.middleware.js';
import * as chat from '../services/chat.service.js';

export function bindChatSockets(io) {
  // ── auth handshake ────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        '';
      const user = await authenticateSocket(token);
      if (!user || !user.active) return next(new Error('unauthorized'));
      socket.user = user;
      next();
    } catch (e) { next(new Error('unauthorized')); }
  });

  io.on('connection', (socket) => {
    const me = socket.user;
    socket.join(`user:${me.id}`);

    // helper p/ emitir para os 2 lados
    const emitToPair = (event, payload, otherId) => {
      io.to(`user:${me.id}`).emit(event, payload);
      io.to(`user:${otherId}`).emit(event, payload);
    };

    // ── enviar mensagem ────────────────────────────────────────────
    socket.on('chat:send', async ({ toUserId, content }, ack) => {
      try {
        const msg = await chat.sendMessage(me, toUserId, content);
        emitToPair('chat:message', msg, toUserId);
        ack?.({ ok: true, message: msg });
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    // ── marcar como lidas ──────────────────────────────────────────
    socket.on('chat:read', async ({ otherId }, ack) => {
      try {
        await chat.listMessages(me.id, otherId, { limit: 1 }); // já marca readAt no service
        emitToPair('chat:read', { byUserId: me.id, otherId }, otherId);
        ack?.({ ok: true });
      } catch (e) { ack?.({ ok: false, error: e.message }); }
    });

    // ── presença simples (online/offline) ──────────────────────────
    io.emit('chat:presence', { userId: me.id, online: true });
    socket.on('disconnect', () => {
      io.emit('chat:presence', { userId: me.id, online: false });
    });

    // typing indicator
    socket.on('chat:typing', ({ toUserId, typing }) => {
      io.to(`user:${toUserId}`).emit('chat:typing', { fromUserId: me.id, typing: !!typing });
    });
  });
}
