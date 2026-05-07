import { prisma } from '../config/prisma.js';

export async function list(req, res, next) {
  try {
    const { page = 1, limit = 100 } = req.query;
    const take = Math.max(1, parseInt(limit, 10) || 100);
    const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * take;
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take, skip }),
      prisma.auditLog.count(),
    ]);
    res.json({ items, total, page: Number(page) || 1, pages: Math.ceil(total / take) });
  } catch (e) { next(e); }
}
