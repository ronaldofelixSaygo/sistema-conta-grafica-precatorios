import { verifyToken } from '../utils/jwt.js';
import { prisma } from '../config/prisma.js';

// Lê JWT do header Authorization: Bearer xxx OU do cookie httpOnly "token".
function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.cookies?.token) return req.cookies.token;
  return null;
}

export async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Não autenticado' });

    const decoded = verifyToken(token);
    if (!decoded?.uid) return res.status(401).json({ error: 'Token inválido' });

    const user = await prisma.user.findUnique({
      where: { id: decoded.uid },
      select: {
        id: true, email: true, name: true, role: true, active: true,
        officeName: true, clienteId: true, themePref: true, parceiroId: true,
      },
    });
    if (!user || !user.active) return res.status(401).json({ error: 'Usuário inválido ou desativado' });

    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Não autenticado' });
  }
}

// Versão para Socket.IO
export async function authenticateSocket(token) {
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded?.uid) return null;
  return prisma.user.findUnique({
    where: { id: decoded.uid },
    select: {
      id: true, email: true, name: true, role: true, active: true,
      officeName: true, clienteId: true, themePref: true, parceiroId: true,
    },
  });
}
