// Middleware de autorização por role.
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

// Permite ADM, SAYGO ou PARTNER do tipo ESCRITORIO. Usado em rotas de clientes
// e movimentacoes onde o parceiro escritorio pode criar/editar dentro do escopo.
export function requireStaffOrPartnerEscritorio(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  const u = req.user;
  if (u.role === 'ADM' || u.role === 'SAYGO') return next();
  if (u.role === 'PARTNER' && u.partnerType === 'ESCRITORIO') return next();
  return res.status(403).json({ error: 'Acesso negado para esse perfil' });
}

// Permite ADM/SAYGO ou CLIENT. Usado pra aprovação final de desoneração:
// quem aprova é o cliente dono (ou o staff em nome dele). Parceiro NÃO pode.
// A validação de "cliente dono" é feita no service.
export function requireStaffOrClient(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  const u = req.user;
  if (u.role === 'ADM' || u.role === 'SAYGO' || u.role === 'CLIENT') return next();
  return res.status(403).json({ error: 'Acesso negado para esse perfil' });
}
