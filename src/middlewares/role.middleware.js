// Middleware de autorização por role.
// Uso: router.get('/x', requireAuth, requireRole('ADM'), handler)
//      ou requireRole('ADM','SAYGO')
export function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
    if (!allowed.includes(req.user.role))
      return res.status(403).json({ error: 'Acesso negado para esse perfil' });
    next();
  };
}

export const requireAdmin = requireRole('ADM');
export const requireStaff = requireRole('ADM', 'SAYGO');
