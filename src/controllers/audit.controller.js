import { prisma } from '../config/prisma.js';

export async function list(req, res, next) {
  try {
    const {
      page = 1, limit = 100,
      userName, action, entity, entityId, details, ip,
      dataIni, dataFim,
    } = req.query;
    const take = Math.max(1, parseInt(limit, 10) || 100);
    const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * take;

    // Filtros por coluna: texto = "contém" case-insensitive (PostgreSQL);
    // Quando = intervalo de datas [dataIni 00:00, dataFim 23:59].
    const where = {};
    const ci = (v) => ({ contains: String(v).trim(), mode: 'insensitive' });
    if (userName) where.userName = ci(userName);
    if (action)   where.action   = ci(action);
    if (entity)   where.entity   = ci(entity);
    if (entityId) where.entityId = ci(entityId);
    if (details)  where.details  = ci(details);
    if (ip)       where.ip       = ci(ip);
    if (dataIni || dataFim) {
      where.createdAt = {};
      if (dataIni) { const d = new Date(dataIni); if (!isNaN(d.getTime())) { d.setHours(0,0,0,0);        where.createdAt.gte = d; } }
      if (dataFim) { const d = new Date(dataFim); if (!isNaN(d.getTime())) { d.setHours(23,59,59,999);   where.createdAt.lte = d; } }
    }

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ items, total, page: Number(page) || 1, pages: Math.ceil(total / take) });
  } catch (e) { next(e); }
}
