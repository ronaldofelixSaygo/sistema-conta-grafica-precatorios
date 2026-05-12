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
    case 'PARTNER': {
      // officeName (preenchido na criação do usuário) é o canônico.
      // Fallback pra parceiroNome (sempre presente se há parceiroId) cobre users
      // antigos criados antes do auto-fill ou com officeName limpo manualmente.
      // Match case-insensitive pra tolerar diferenças de digitação ao cadastrar
      // o escritório no cliente.
      const office = user.officeName || user.parceiroNome;
      return office
        ? { escritorio: { equals: office, mode: 'insensitive' } }
        : { id: -1 };
    }
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
    case 'PARTNER': {
      const office = user.officeName || user.parceiroNome;
      return office
        ? { cliente: { escritorio: { equals: office, mode: 'insensitive' } } }
        : { id: -1 };
    }
    case 'CLIENT':
      return user.clienteId ? { clienteId: user.clienteId } : { id: -1 };
    default:
      return { id: -1 };
  }
}

// Pode editar/criar/deletar clientes? ADM, SAYGO ou PARTNER do tipo ESCRITORIO.
// O escopo (clienteScope) ja garante que parceiro so mexe nos clientes dele.
export function canMutateCliente(user) {
  if (!user) return false;
  if (user.role === 'ADM' || user.role === 'SAYGO') return true;
  if (user.role === 'PARTNER' && user.partnerType === 'ESCRITORIO') return true;
  return false;
}

// Pode editar/criar/deletar movimentacoes? Mesma regra acima.
export function canMutateMovimentacao(user) {
  if (!user) return false;
  if (user.role === 'ADM' || user.role === 'SAYGO') return true;
  if (user.role === 'PARTNER' && user.partnerType === 'ESCRITORIO') return true;
  return false;
}

// Lista de roles que podem ver tela de admin de usuários
export function canManageUsers(user) {
  return user && user.role === 'ADM';
}
