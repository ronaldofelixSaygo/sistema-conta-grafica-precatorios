import { prisma } from '../config/prisma.js';

export async function logAction({ user, action, entity, entityId, details, ip }) {
  try {
    await prisma.auditLog.create({
      data: {
        userId:   user?.id   ?? null,
        userName: user?.name ?? null,
        action,
        entity:   entity ?? null,
        entityId: entityId != null ? String(entityId) : null,
        details:  details ?? null,
        ip:       ip ?? null,
      },
    });
  } catch (e) {
    console.error('[audit] falhou:', e.message);
  }
}
