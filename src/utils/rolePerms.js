// =====================================================================
// Permissoes efetivas do usuario, considerando role + tipo de parceiro.
// =====================================================================
// Modulos disponiveis no sistema:
export const MODULES = [
  'dashboard','clientes','movimentacoes','saldos','comissoes',
  'relatorios','alertas','kanban','acionamentos','parceiros',
  'usuarios','auditoria','chat','parametros',
];

// Modulos que cada role/tipo de parceiro pode VER:
function modulesForUser(user) {
  if (!user) return new Set();
  if (user.role === 'ADM') return new Set(MODULES);
  if (user.role === 'SAYGO') {
    // Saygo: tudo exceto parametros (so adm)
    return new Set(MODULES.filter(m => !['parametros','usuarios','auditoria'].includes(m)));
  }
  if (user.role === 'CLIENT') {
    return new Set(['dashboard','clientes','movimentacoes','saldos','kanban','acionamentos','chat']);
  }
  if (user.role === 'PARTNER') {
    // depende do tipo do parceiro vinculado
    const t = user.partnerType || 'OUTRO';
    if (t === 'ESCRITORIO') {
      return new Set(['dashboard','clientes','movimentacoes','saldos','comissoes','relatorios','alertas','kanban','acionamentos','chat']);
    }
    // ARMADOR_LOGISTICO ou OUTRO: so kanban + chat
    return new Set(['dashboard','kanban','chat']);
  }
  return new Set();
}

export function canView(user, mod) {
  return modulesForUser(user).has(mod);
}

export function canMutate(user, mod) {
  if (!user) return false;
  if (user.role === 'ADM') return true;
  if (user.role === 'SAYGO') {
    return ['clientes','movimentacoes','kanban','acionamentos','parceiros','comissoes'].includes(mod);
  }
  if (user.role === 'PARTNER') {
    const t = user.partnerType || 'OUTRO';
    if (t === 'ESCRITORIO') {
      // Escritorio tem as mesmas mutacoes que SAYGO, mas o escopo
      // (clienteScope) ja restringe aos clientes vinculados ao seu escritorio.
      return ['clientes','movimentacoes','kanban','acionamentos','comissoes'].includes(mod);
    }
    return ['kanban'].includes(mod);
  }
  if (user.role === 'CLIENT') return ['acionamentos'].includes(mod);
  return false;
}

// Helpers para a UI conhecer as permissoes
export function effectivePerms(user) {
  return {
    modules: [...modulesForUser(user)],
    role: user?.role,
    partnerType: user?.partnerType || null,
  };
}
