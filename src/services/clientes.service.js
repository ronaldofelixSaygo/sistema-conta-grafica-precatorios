import ExcelJS from 'exceljs';
import { prisma } from '../config/prisma.js';
import { clienteScope, canMutateCliente } from '../utils/scope.js';
import { effectivePerms, applyRestrictions } from './permissions.service.js';

async function getRestrictedFields(user) {
  const p = await effectivePerms(user);
  return p.byModule?.clientes?.restrictedFields || [];
}

function toNumberOrNull(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}

export async function listClientes(user) {
  // Paralelo: a busca de items e o cálculo de restricted independem entre si.
  const [items, restricted] = await Promise.all([
    prisma.cliente.findMany({
      where: clienteScope(user),
      orderBy: { nome: 'asc' },
    }),
    getRestrictedFields(user),
  ]);
  return items.map(c => applyRestrictions(c, restricted));
}

export async function getCliente(user, id) {
  const where = { ...clienteScope(user), id: Number(id) };
  const [c, restricted] = await Promise.all([
    prisma.cliente.findFirst({ where }),
    getRestrictedFields(user),
  ]);
  if (!c) return null;
  return applyRestrictions(c, restricted);
}

export async function createCliente(user, data) {
  if (!canMutateCliente(user)) { const e=new Error('Sem permissão'); e.status=403; throw e; }
  if (!data.nome) { const e=new Error('Nome é obrigatório'); e.status=400; throw e; }
  return prisma.cliente.create({
    data: {
      nome: data.nome,
      cnpj: data.cnpj || null,
      cnpjFilial: data.cnpj_filial || data.cnpjFilial || null,
      escritorio: data.escritorio || null,
      locacaoSala: data.locacao_sala || data.locacaoSala || null,
      aberturaFilial: data.abertura_filial || data.aberturaFilial || null,
      reativacaoIe: data.reativacao_ie || data.reativacaoIe || null,
      contaGrafica: data.conta_grafica || data.contaGrafica || null,
      clienteCertificado: data.cliente_certificado || data.clienteCertificado || null,
      parceiroSala: data.parceiro_sala || data.parceiroSala || null,
      parceiroFilial: data.parceiro_filial || data.parceiroFilial || null,
      parceiroIe: data.parceiro_ie || data.parceiroIe || null,
      observacoes: data.observacoes || null,
      percentualComissao: toNumberOrNull(data.percentual_comissao ?? data.percentualComissao) ?? 0,
      diaFechamento:      toNumberOrNull(data.dia_fechamento      ?? data.diaFechamento)      ?? 1,
      valorPorDi:         toNumberOrNull(data.valor_por_di        ?? data.valorPorDi)         ?? 0,
      despachanteId:      (data.despachante_id ?? data.despachanteId) || null,
    },
  });
}

export async function updateCliente(user, id, data) {
  if (!canMutateCliente(user)) { const e=new Error('Sem permissão'); e.status=403; throw e; }
  // Garantir que o registro está no escopo do user (parceiro/cliente nunca chega aqui pelas rotas, mas é defesa)
  const existing = await prisma.cliente.findFirst({ where: { ...clienteScope(user), id: Number(id) } });
  if (!existing) { const e=new Error('Cliente não encontrado'); e.status=404; throw e; }

  return prisma.cliente.update({
    where: { id: Number(id) },
    data: {
      ...(data.nome               !== undefined && { nome: data.nome }),
      ...(data.cnpj               !== undefined && { cnpj: data.cnpj || null }),
      ...((data.cnpj_filial ?? data.cnpjFilial) !== undefined && { cnpjFilial: data.cnpj_filial ?? data.cnpjFilial ?? null }),
      ...(data.escritorio         !== undefined && { escritorio: data.escritorio || null }),
      ...((data.locacao_sala ?? data.locacaoSala) !== undefined && { locacaoSala: data.locacao_sala ?? data.locacaoSala ?? null }),
      ...((data.abertura_filial ?? data.aberturaFilial) !== undefined && { aberturaFilial: data.abertura_filial ?? data.aberturaFilial ?? null }),
      ...((data.reativacao_ie ?? data.reativacaoIe) !== undefined && { reativacaoIe: data.reativacao_ie ?? data.reativacaoIe ?? null }),
      ...((data.conta_grafica ?? data.contaGrafica) !== undefined && { contaGrafica: data.conta_grafica ?? data.contaGrafica ?? null }),
      ...((data.cliente_certificado ?? data.clienteCertificado) !== undefined && { clienteCertificado: data.cliente_certificado ?? data.clienteCertificado ?? null }),
      ...((data.parceiro_sala ?? data.parceiroSala) !== undefined && { parceiroSala: data.parceiro_sala ?? data.parceiroSala ?? null }),
      ...((data.parceiro_filial ?? data.parceiroFilial) !== undefined && { parceiroFilial: data.parceiro_filial ?? data.parceiroFilial ?? null }),
      ...((data.parceiro_ie ?? data.parceiroIe) !== undefined && { parceiroIe: data.parceiro_ie ?? data.parceiroIe ?? null }),
      ...(data.observacoes        !== undefined && { observacoes: data.observacoes || null }),
      ...((data.percentual_comissao ?? data.percentualComissao) !== undefined && { percentualComissao: toNumberOrNull(data.percentual_comissao ?? data.percentualComissao) ?? 0 }),
      ...((data.dia_fechamento ?? data.diaFechamento) !== undefined && { diaFechamento: toNumberOrNull(data.dia_fechamento ?? data.diaFechamento) ?? 1 }),
      ...((data.valor_por_di ?? data.valorPorDi) !== undefined && { valorPorDi: toNumberOrNull(data.valor_por_di ?? data.valorPorDi) ?? 0 }),
      ...((data.despachante_id ?? data.despachanteId) !== undefined && { despachanteId: (data.despachante_id ?? data.despachanteId) || null }),
    },
  });
}

export async function deleteCliente(user, id) {
  if (!canMutateCliente(user)) { const e=new Error('Sem permissão'); e.status=403; throw e; }
  return prisma.cliente.delete({ where: { id: Number(id) } });
}

// Exporta TODOS os clientes do escopo do usuário pra Excel.
// Inclui todas as colunas da tabela, respeitando os restrictedFields do perfil.
export async function exportClientesExcel(user, res) {
  const [items, restricted] = await Promise.all([
    prisma.cliente.findMany({
      where: clienteScope(user),
      orderBy: { nome: 'asc' },
    }),
    getRestrictedFields(user),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vision — Conta Gráfica';
  wb.created = new Date();
  const ws = wb.addWorksheet('Clientes');

  // Define todas as colunas (mesma ordem do schema Cliente)
  const allColumns = [
    { header: 'ID',                  key: 'id',                 width: 8  },
    { header: 'Nome',                key: 'nome',               width: 40 },
    { header: 'CNPJ',                key: 'cnpj',               width: 20 },
    { header: 'CNPJ Filial',         key: 'cnpjFilial',         width: 20 },
    { header: 'Escritório',          key: 'escritorio',         width: 22 },
    { header: 'Locação Sala',        key: 'locacaoSala',        width: 14 },
    { header: 'Abertura Filial',     key: 'aberturaFilial',     width: 14 },
    { header: 'Reativação IE',       key: 'reativacaoIe',       width: 14 },
    { header: 'Conta Gráfica',       key: 'contaGrafica',       width: 14 },
    { header: 'Cliente Certificado', key: 'clienteCertificado', width: 18 },
    { header: 'Parceiro Sala',       key: 'parceiroSala',       width: 22 },
    { header: 'Parceiro Filial',     key: 'parceiroFilial',     width: 22 },
    { header: 'Parceiro IE',         key: 'parceiroIe',         width: 22 },
    { header: '% Comissão',          key: 'percentualComissao', width: 12 },
    { header: 'Dia Fechamento',      key: 'diaFechamento',      width: 14 },
    { header: 'Valor por DI/Duimp',  key: 'valorPorDi',         width: 16 },
    { header: 'Observações',         key: 'observacoes',        width: 50 },
    { header: 'Criado em',           key: 'createdAt',          width: 18 },
    { header: 'Atualizado em',       key: 'updatedAt',          width: 18 },
  ];
  // Remove colunas restritas para o perfil do usuário
  ws.columns = allColumns.filter(c => !restricted.includes(c.key));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };

  const fmtDateTime = d => d ? new Date(d).toLocaleString('pt-BR') : '';
  for (const c of items) {
    const masked = applyRestrictions(c, restricted);
    ws.addRow({
      id: masked.id,
      nome: masked.nome,
      cnpj: masked.cnpj,
      cnpjFilial: masked.cnpjFilial,
      escritorio: masked.escritorio,
      locacaoSala: masked.locacaoSala,
      aberturaFilial: masked.aberturaFilial,
      reativacaoIe: masked.reativacaoIe,
      contaGrafica: masked.contaGrafica,
      clienteCertificado: masked.clienteCertificado,
      parceiroSala: masked.parceiroSala,
      parceiroFilial: masked.parceiroFilial,
      parceiroIe: masked.parceiroIe,
      percentualComissao: masked.percentualComissao,
      diaFechamento: masked.diaFechamento,
      valorPorDi: masked.valorPorDi,
      observacoes: masked.observacoes,
      createdAt: fmtDateTime(masked.createdAt),
      updatedAt: fmtDateTime(masked.updatedAt),
    });
  }
  // Freeze a primeira linha pra ficar sticky na rolagem
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const filename = `clientes-${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

// Atualização em lote de comissão e dia de fechamento
export async function bulkUpdateComissao(user, payload) {
  if (!canMutateCliente(user)) { const e=new Error('Sem permissão'); e.status=403; throw e; }
  const ids = (payload?.cliente_ids || payload?.ids || []).map(Number).filter(Boolean);
  if (ids.length === 0) return { count: 0 };
  const data = {};
  if (payload.percentual_comissao !== undefined) data.percentualComissao = Number(payload.percentual_comissao) || 0;
  if (payload.dia_fechamento      !== undefined) data.diaFechamento      = Number(payload.dia_fechamento)      || 1;
  const r = await prisma.cliente.updateMany({ where: { id: { in: ids } }, data });
  return { count: r.count };
}
