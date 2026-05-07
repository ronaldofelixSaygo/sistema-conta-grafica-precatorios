// Entrypoint — inicia HTTP + Socket.IO juntos.
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

import { env } from './config/env.js';
import { createApp } from './app.js';
import { bindChatSockets } from './sockets/chat.socket.js';
import { prisma } from './config/prisma.js';

const app = createApp();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: { origin: env.CORS_ORIGIN, credentials: true },
});
bindChatSockets(io);

// shutdown gracioso
function shutdown(sig) {
  return async () => {
    console.log(`\n[${sig}] desligando…`);
    io.close();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
}
process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT',  shutdown('SIGINT'));

server.listen(env.PORT, () => {
  console.log(`🚀 Sistema Conta Gráfica rodando em http://localhost:${env.PORT}`);
  console.log(`   Modo: ${env.NODE_ENV}`);
  if (!env.DATABASE_URL) console.warn('⚠ DATABASE_URL ausente — defina antes das migrations.');
});
