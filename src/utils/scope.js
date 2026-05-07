// =====================================================================
// Scoping de dados por role.
// Devolve cláusulas Prisma `where` que restringem a leitura conforme:
//   ADM/SAYGO  → sem restrição (objeto vazio)
//   PARTNER    → só clientes onde escritorio = user.officeName
//   CLIENT     → só seu próprio cliente (user.clienteId)
// =====================================================================

export function clienteScope(user) {
  if (!user) return { id: -1 }; // anônimo: nada
  switch (user.role) {
    case 'ADM':
    case 'SAYGO':
      return {};
    case 'PARTNER':
      return user.officeName
        ? { escritorio: user.officeName }
        : { id: -1 }; // parceiro sem escritório definido não vê nada
    case 'CLIENT':
      return user.clienteId ? { id: user.clienteId } : { id: -1 };
    default:
      return { id: -1 };
  }
}

// Para queries em Movimentação: filtra via cliente vinculado.
export function movimentacaoScope(user) {
  if (!user) return { id: -1 };
  switch (user.role) {
    case 'ADM':
    case 'SAYGO':
      return {};
    case 'PARTNER':
      return user.officeName
        ? { cliente: { escritorio: user.officeName } }
        : { id: -1 };
    case 'CLIENT':
      return user.clienteId ? { clienteId: user.clienteId } : { id: -1 };
    default:
      return { id: -1 };
  }
}

// Pode editar/criar/deletar clientes? Apenas ADM e SAYGO.
export function canMutateCliente(user) {
  return user && (user.role === 'ADM' || user.role === 'SAYGO');
}

// Pode editar/criar/deletar movimentações? ADM, SAYGO. Parceiros e Clientes apenas leem.
export function canMutateMovimentacao(user) {
  return user && (user.role === 'ADM' || user.role === 'SAYGO');
}

// Lista de roles que podem ver tela de admin de usuários
export function canManageUsers(user) {
  return user && user.role === 'ADM';
}
