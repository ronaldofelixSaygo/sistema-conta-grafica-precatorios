// Entrypoint - inicia HTTP + Socket.IO juntos.
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

import { env } from './config/env.js';
import { createApp } from './app.js';
import { bindChatSockets } from './sockets/chat.socket.js';
import { prisma } from './config/prisma.js';
import { ensureBuiltin as ensureBuiltinPartnerKinds } from './services/partnerKind.service.js';
import { startStorageMonitor } from './services/storageAlert.service.js';

// Seed dos tipos built-in. Não bloqueia o boot — se falhar, os endpoints
// que dependem disso fazem ensureBuiltin sob demanda também.
ensureBuiltinPartnerKinds().catch(e => console.warn('[partnerKind] seed builtin falhou:', e.message));

// Monitor periódico de storage — checa a cada 1h e dispara e-mail pros
// admins quando passar de 80% do limite Neon Free (500 MB).
startStorageMonitor();

const app = createApp();
const server = http.createServer(app);

// CORS do Socket.IO: aceita qualquer origin com credentials (reflete o origin do request).
// Origin '*' nao funciona com credentials:true; precisa refletir explicitamente.
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, cb) => cb(null, origin || true),
    credentials: true,
  },
});
bindChatSockets(io);

// shutdown gracioso
function shutdown(sig) {
  return async () => {
    console.log('[' + sig + '] desligando...');
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
  console.log('Sistema Conta Grafica rodando em http://localhost:' + env.PORT);
  console.log('   Modo: ' + env.NODE_ENV);
  if (!env.DATABASE_URL) console.warn('AVISO: DATABASE_URL ausente - defina antes das migrations.');
});
