import { verifyToken } from '../utils/jwt.js';
import { prisma } from '../config/prisma.js';

function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.cookies?.token) return req.cookies.token;
  return null;
}

async function loadUser(uid) {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: {
      id: true, email: true, name: true, role: true, active: true,
      officeName: true, clienteId: true, themePref: true, parceiroId: true,
      parceiro: { select: { id: true, type: true, nome: true } },
    },
  });
  if (!user) return null;
  // Achata o tipo do parceiro pra facilitar uso em scope/perms
  return {
    ...user,
    partnerType: user.parceiro?.type || null,
    parceiroNome: user.parceiro?.nome || null,
  };
}

export async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    const decoded = verifyToken(token);
    if (!decoded?.uid) return res.status(401).json({ error: 'Token inválido' });

    const user = await loadUser(decoded.uid);
    if (!user || !user.active) return res.status(401).json({ error: 'Usuário inválido ou desativado' });

    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Não autenticado' });
  }
}

export async function authenticateSocket(token) {
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded?.uid) return null;
  return loadUser(decoded.uid);
}
