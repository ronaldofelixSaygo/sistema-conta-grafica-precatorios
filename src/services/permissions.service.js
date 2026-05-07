import { prisma } from '../config/prisma.js';

const ROLES = ['ADM','SAYGO','PARTNER','CLIENT'];
const MODULES = [
  'dashboard','clientes','movimentacoes','saldos','comissoes',
  'relatorios','alertas','kanban','acionamentos','parceiros',
  'usuarios','auditoria','migracao','chat','parametros',
];

// Defaults: tabela de permissões inicial usada no first-run
function defaults() {
  const out = [];
  for (const role of ROLES) {
    for (const m of MODULES) {
      let canView=false, canCreate=false, canEdit=false, canDelete=false;
      if (role === 'ADM') { canView=canCreate=canEdit=canDelete=true; }
      else if (role === 'SAYGO') {
        canView = !['parametros'].includes(m);
        canCreate = ['clientes','movimentacoes','kanban','acionamentos','parceiros'].includes(m);
        canEdit   = canCreate;
        canDelete = canCreate;
      } else if (role === 'PARTNER') {
        canView = ['dashboard','clientes','movimentacoes','saldos','comissoes','kanban','acionamentos','chat'].includes(m);
        canCreate = ['acionamentos'].includes(m);
        canEdit   = ['acionamentos','kanban'].includes(m);
        canDelete = false;
      } else if (role === 'CLIENT') {
        canView = ['dashboard','clientes','movimentacoes','saldos','kanban','acionamentos','chat'].includes(m);
        canCreate = ['acionamentos'].includes(m);
        canEdit   = false;
        canDelete = false;
      }
      out.push({ role, module: m, canView, canCreate, canEdit, canDelete });
    }
  }
  return out;
}

export async function ensureDefaults() {
  const count = await prisma.rolePermission.count();
  if (count > 0) return;
  await prisma.rolePermission.createMany({ data: defaults() });
}

export async function listAll() {
  await ensureDefaults();
  return prisma.rolePermission.findMany({
    orderBy: [{ role: 'asc' }, { module: 'asc' }],
  });
}

export async function update(id, data) {
  return prisma.rolePermission.update({
    where: { id },
    data: {
      canView:   !!data.canView,
      canCreate: !!data.canCreate,
      canEdit:   !!data.canEdit,
      canDelete: !!data.canDelete,
    },
  });
}

export async function resetToDefaults() {
  await prisma.rolePermission.deleteMany({});
  await prisma.rolePermission.createMany({ data: defaults() });
  return { ok: true };
}

export const META = { ROLES, MODULES };
