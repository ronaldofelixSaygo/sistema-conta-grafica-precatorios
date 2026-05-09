import { prisma } from '../config/prisma.js';

// Audit log "fire and forget": não bloqueia o request response.
// O caller pode fazer `await logAction(...)` mas a Promise resolve imediatamente —
// o insert acontece em background e qualquer erro é apenas logado no console.
export function logAction({ user, action, entity, entityId, details, ip }) {
  setImmediate(() => {
    prisma.auditLog.create({
      data: {
        userId:   user?.id   ?? null,
        userName: user?.name ?? null,
        action,
        entity:   entity ?? null,
        entityId: entityId != null ? String(entityId) : null,
        details:  details ?? null,
        ip:       ip ?? null,
      },
    }).catch(e => console.error('[audit] falhou:', e.message));
  });
  return Promise.resolve();
}
