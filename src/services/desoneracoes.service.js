// =====================================================================
// Desonerações — CRUD + transições de etapa + aprovação que gera movimentação.
//
// Fluxo (após aquisição via Solicitação de Créditos):
//   DOCS_DESPACHANTE → EMISSAO_DMI → EMISSAO_NF → VALIDACAO_NF →
//   ENVIO_NF_OFICIAL → PROTOCOLO_ICMS → (AGUARDANDO_APROVACAO) → CONCLUIDA
//
// Cada etapa registra o parceiro responsável, permitindo consolidação por
// parceiro (DesoneracaoStep). Documentos obrigatórios são configuráveis em
// DesoneracaoDocConfig por (modal, etapa).
// =====================================================================
import { prisma } from '../config/prisma.js';

const STEPS_ORDER = [
  'DOCS_DESPACHANTE',
  'EMISSAO_DMI',
  'EMISSAO_NF',
  'VALIDACAO_NF',
  'ENVIO_NF_OFICIAL',
  'PROTOCOLO_ICMS',
  'CONCLUIDO',
];

function nextStep(cur) {
  const i = STEPS_ORDER.indexOf(cur);
  return i < 0 || i === STEPS_ORDER.length - 1 ? null : STEPS_ORDER[i + 1];
}

// Documentos obrigatórios por etapa × modal. Padrão; pode ser sobrescrito
// pela tabela DesoneracaoDocConfig em runtime via configs do admin.
const DEFAULT_DOCS_BY_STEP = {
  DOCS_DESPACHANTE: {
    TODOS:    ['DUIMP', 'PL', 'PI', 'AFRMM', 'BL'],
    MARITIMO: ['DUIMP', 'PL', 'PI', 'AFRMM', 'BL'],
    AEREO:    ['DUIMP', 'PL', 'PI', 'AFRMM', 'BL', 'CCT'],
    RODOVIARIO: ['DUIMP', 'PL', 'PI', 'AFRMM', 'BL'],
  },
  EMISSAO_DMI: { TODOS: ['DMI'] },
  PROTOCOLO_ICMS: { TODOS: ['DESPACHO'] },
};

// Resolve quais documentos são EXIGIDOS ao avançar uma etapa, considerando
// modal e overrides do admin. Retorna [{ tipo, obrigatorio }].
async function getRequiredDocs(modal, etapa) {
  // overrides do admin (tabela DesoneracaoDocConfig)
  const overrides = await prisma.desoneracaoDocConfig.findMany({
    where: {
      etapa,
      OR: [{ modal }, { modal: 'TODOS' }],
    },
  });
  if (overrides.length) {
    // se há config, usa só ela (admin tem controle total)
    return overrides
      .filter(o => o.obrigatorio)
      .map(o => o.tipoDocumento);
  }
  const def = DEFAULT_DOCS_BY_STEP[etapa] || {};
  return def[modal] || def.TODOS || [];
}

// === CRUD principal ===

export async function listDesoneracoes(filters = {}) {
  const where = {};
  if (filters.clienteId) where.clienteId = Number(filters.clienteId);
  if (filters.status) where.status = filters.status;
  if (filters.currentStep) where.currentStep = filters.currentStep;
  if (filters.from) where.createdAt = { ...(where.createdAt || {}), gte: new Date(filters.from) };
  if (filters.to)   where.createdAt = { ...(where.createdAt || {}), lte: new Date(filters.to) };
  // Filtro por parceiro: aparece em alguma etapa
  if (filters.parceiroId) {
    where.steps = { some: { parceiroId: filters.parceiroId } };
  }
  return prisma.desoneracao.findMany({
    where,
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true } },
      steps: { include: { parceiro: { select: { id: true, nome: true } } } },
      _count: { select: { notas: true, documentos: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function getDesoneracao(id) {
  const r = await prisma.desoneracao.findUnique({
    where: { id },
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true, cnpj: true } },
      creditRequest: { select: { id: true, creditosACompar: true, modalidade: true } },
      createdBy: { select: { id: true, name: true } },
      movimentacao: true,
      steps: {
        include: {
          parceiro: { select: { id: true, nome: true, type: true, kindCode: true } },
          completedBy: { select: { id: true, name: true } },
        },
        orderBy: { etapa: 'asc' },
      },
      notas: { orderBy: { createdAt: 'asc' } },
      documentos: {
        select: { id: true, tipo: true, nome: true, mime: true, createdAt: true, uploadedBy: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      eventos: {
        include: { byUser: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      },
    },
  });
  if (!r) { const e = new Error('Desoneração não encontrada'); e.status = 404; throw e; }
  return r;
}

export async function createDesoneracao(user, data) {
  if (!data.clienteId) { const e = new Error('clienteId obrigatório'); e.status = 400; throw e; }
  if (!data.modal || !['MARITIMO','AEREO','RODOVIARIO'].includes(data.modal)) {
    const e = new Error('Modal de transporte obrigatório'); e.status = 400; throw e;
  }
  const cliente = await prisma.cliente.findUnique({ where: { id: Number(data.clienteId) } });
  if (!cliente) { const e = new Error('Cliente não encontrado'); e.status = 404; throw e; }

  // Cria a desoneração + todos os steps em branco numa transação
  const result = await prisma.$transaction(async (tx) => {
    const d = await tx.desoneracao.create({
      data: {
        clienteId: cliente.id,
        creditRequestId: data.creditRequestId || null,
        numeroProcesso: data.numeroProcesso || null,
        duimpDi: data.duimpDi || null,
        modal: data.modal,
        valorMercadoria: data.valorMercadoria != null ? Number(data.valorMercadoria) : null,
        valorIcmsDesonerado: data.valorIcmsDesonerado != null ? Number(data.valorIcmsDesonerado) : null,
        status: 'EM_ANDAMENTO',
        currentStep: 'DOCS_DESPACHANTE',
        createdById: user.id,
      },
    });
    // Cria 1 row por etapa do fluxo (CONCLUIDO é estado final, não tem step ativo)
    const stepsToCreate = STEPS_ORDER.filter(s => s !== 'CONCLUIDO').map(etapa => ({
      desoneracaoId: d.id,
      etapa,
      parceiroId: data.parceiros?.[etapa] || null,
    }));
    await tx.desoneracaoStep.createMany({ data: stepsToCreate });
    await tx.desoneracaoEvento.create({
      data: {
        desoneracaoId: d.id,
        etapa: 'DOCS_DESPACHANTE',
        acao: 'CRIADA',
        descricao: `Desoneração criada por ${user.name}`,
        byUserId: user.id,
      },
    });
    return d;
  });
  return getDesoneracao(result.id);
}

export async function updateDesoneracao(user, id, data) {
  const cur = await prisma.desoneracao.findUnique({ where: { id } });
  if (!cur) { const e = new Error('Desoneração não encontrada'); e.status = 404; throw e; }
  if (cur.status === 'CONCLUIDA' || cur.status === 'CANCELADA') {
    const e = new Error('Não é possível editar uma desoneração concluída/cancelada'); e.status = 400; throw e;
  }
  const upd = {};
  if (data.numeroProcesso !== undefined) upd.numeroProcesso = data.numeroProcesso || null;
  if (data.duimpDi !== undefined) upd.duimpDi = data.duimpDi || null;
  if (data.modal !== undefined && ['MARITIMO','AEREO','RODOVIARIO'].includes(data.modal)) upd.modal = data.modal;
  if (data.valorMercadoria !== undefined) upd.valorMercadoria = data.valorMercadoria != null ? Number(data.valorMercadoria) : null;
  if (data.valorIcmsDesonerado !== undefined) upd.valorIcmsDesonerado = data.valorIcmsDesonerado != null ? Number(data.valorIcmsDesonerado) : null;
  if (Object.keys(upd).length === 0) return getDesoneracao(id);
  await prisma.desoneracao.update({ where: { id }, data: upd });
  await prisma.desoneracaoEvento.create({
    data: { desoneracaoId: id, acao: 'ATUALIZADA', byUserId: user.id, descricao: 'Dados gerais editados' },
  });
  return getDesoneracao(id);
}

export async function setStepParceiro(user, id, etapa, parceiroId) {
  const cur = await prisma.desoneracao.findUnique({ where: { id } });
  if (!cur) { const e = new Error('Desoneração não encontrada'); e.status = 404; throw e; }
  await prisma.desoneracaoStep.update({
    where: { desoneracaoId_etapa: { desoneracaoId: id, etapa } },
    data: { parceiroId: parceiroId || null },
  });
  return getDesoneracao(id);
}

// Avança a etapa atual. Valida obrigatoriedades (docs/NFs) antes.
export async function advanceStep(user, id, { parceiroId, notes } = {}) {
  const cur = await prisma.desoneracao.findUnique({
    where: { id },
    include: {
      steps: true,
      notas: true,
      documentos: { select: { tipo: true } },
    },
  });
  if (!cur) { const e = new Error('Desoneração não encontrada'); e.status = 404; throw e; }
  if (cur.status !== 'EM_ANDAMENTO') {
    const e = new Error(`Status ${cur.status} não permite avanço`); e.status = 400; throw e;
  }
  const etapaAtual = cur.currentStep;

  // === Validações específicas por etapa ===
  const tipos = new Set(cur.documentos.map(d => d.tipo));

  // Docs obrigatórios pra etapa atual
  const obrigatorios = await getRequiredDocs(cur.modal, etapaAtual);
  const faltando = obrigatorios.filter(t => !tipos.has(t));
  if (faltando.length) {
    const e = new Error(`Documentos obrigatórios faltando: ${faltando.join(', ')}`);
    e.status = 400; throw e;
  }

  // NFs: na EMISSAO_NF precisa pelo menos 1 entrada e 1 saída.
  if (etapaAtual === 'EMISSAO_NF') {
    const tem = (t) => cur.notas.some(n => n.tipo === t);
    if (!tem('ENTRADA') || !tem('SAIDA')) {
      const e = new Error('Cadastre ao menos 1 NF de Entrada e 1 NF de Saída antes de avançar');
      e.status = 400; throw e;
    }
  }
  // VALIDACAO_NF: todas NFs devem estar marcadas como validadas
  if (etapaAtual === 'VALIDACAO_NF') {
    if (cur.notas.some(n => !n.validada)) {
      const e = new Error('Existem NFs ainda não validadas');
      e.status = 400; throw e;
    }
  }
  // ENVIO_NF_OFICIAL: todas NFs precisam ter PDF oficial anexado
  if (etapaAtual === 'ENVIO_NF_OFICIAL') {
    if (cur.notas.some(n => !n.oficialBytes)) {
      const e = new Error('Existem NFs sem PDF oficial anexado');
      e.status = 400; throw e;
    }
  }

  // === Marca etapa atual como concluída + define próxima ===
  const proxima = nextStep(etapaAtual);
  await prisma.$transaction(async (tx) => {
    await tx.desoneracaoStep.update({
      where: { desoneracaoId_etapa: { desoneracaoId: id, etapa: etapaAtual } },
      data: {
        completedAt: new Date(),
        completedById: user.id,
        parceiroId: parceiroId || undefined,
        notes: notes || undefined,
      },
    });
    if (proxima === 'CONCLUIDO') {
      // Última etapa real foi PROTOCOLO_ICMS — agora aguarda aprovação pra criar movimentação
      await tx.desoneracao.update({
        where: { id },
        data: { status: 'AGUARDANDO_APROVACAO', currentStep: 'CONCLUIDO' },
      });
    } else {
      await tx.desoneracao.update({
        where: { id },
        data: { currentStep: proxima },
      });
    }
    await tx.desoneracaoEvento.create({
      data: {
        desoneracaoId: id, etapa: etapaAtual, acao: 'ETAPA_AVANCADA',
        descricao: `Etapa ${etapaAtual} concluída por ${user.name}`,
        byUserId: user.id,
      },
    });
  });
  return getDesoneracao(id);
}

// Aprovação final: gera Movimentação e marca status CONCLUIDA.
export async function approveAndCreateMovimentacao(user, id) {
  const d = await prisma.desoneracao.findUnique({
    where: { id },
    include: { cliente: true, steps: { include: { parceiro: true } } },
  });
  if (!d) { const e = new Error('Desoneração não encontrada'); e.status = 404; throw e; }
  if (d.status !== 'AGUARDANDO_APROVACAO') {
    const e = new Error('Só é possível aprovar quando status = AGUARDANDO_APROVACAO'); e.status = 400; throw e;
  }
  if (!d.duimpDi) { const e = new Error('DUIMP/DI é obrigatório pra criar a movimentação'); e.status = 400; throw e; }
  if (!d.valorIcmsDesonerado || d.valorIcmsDesonerado <= 0) {
    const e = new Error('Valor ICMS desonerado obrigatório'); e.status = 400; throw e;
  }
  const protocoloStep = d.steps.find(s => s.etapa === 'PROTOCOLO_ICMS');
  const parceiroNome = protocoloStep?.parceiro?.nome || d.cliente.escritorio || 'Saygo';
  const dataDespacho = new Date();

  const mov = await prisma.$transaction(async (tx) => {
    const m = await tx.movimentacao.create({
      data: {
        clienteId: d.clienteId,
        tipoMovimento: 'Débitos de Liquidações',
        dataNf: dataDespacho,
        duimpDiProcesso: d.duimpDi,
        parceiro: parceiroNome,
        dataExoneracao: dataDespacho,
        valor: d.valorIcmsDesonerado,
        valorAjustado: -Math.abs(d.valorIcmsDesonerado),
      },
    });
    await tx.desoneracao.update({
      where: { id },
      data: {
        status: 'CONCLUIDA',
        concludedAt: dataDespacho,
        movimentacaoId: m.id,
      },
    });
    await tx.desoneracaoEvento.create({
      data: {
        desoneracaoId: id, etapa: 'CONCLUIDO', acao: 'APROVADA',
        descricao: `Movimentação #${m.id} criada e desoneração concluída por ${user.name}`,
        byUserId: user.id,
      },
    });
    return m;
  });
  return { ...(await getDesoneracao(id)), movimentacao: mov };
}

export async function cancelDesoneracao(user, id, reason) {
  const cur = await prisma.desoneracao.findUnique({ where: { id } });
  if (!cur) { const e = new Error('Desoneração não encontrada'); e.status = 404; throw e; }
  if (cur.status === 'CONCLUIDA' || cur.status === 'CANCELADA') {
    const e = new Error('Status atual não permite cancelar'); e.status = 400; throw e;
  }
  await prisma.desoneracao.update({
    where: { id }, data: { status: 'CANCELADA', cancelReason: reason || null },
  });
  await prisma.desoneracaoEvento.create({
    data: {
      desoneracaoId: id, acao: 'CANCELADA',
      descricao: reason || 'Sem motivo informado',
      byUserId: user.id,
    },
  });
  return getDesoneracao(id);
}

// === Notas Fiscais ===
export async function addNota(user, id, data) {
  const cur = await prisma.desoneracao.findUnique({ where: { id } });
  if (!cur) { const e = new Error('Desoneração não encontrada'); e.status = 404; throw e; }
  if (!['ENTRADA','SAIDA'].includes(data.tipo)) {
    const e = new Error("Tipo deve ser 'ENTRADA' ou 'SAIDA'"); e.status = 400; throw e;
  }
  if (!data.numero) { const e = new Error('Número da NF obrigatório'); e.status = 400; throw e; }
  const n = await prisma.desoneracaoNota.create({
    data: {
      desoneracaoId: id,
      tipo: data.tipo,
      numero: String(data.numero),
      serie: data.serie || null,
      dataEmissao: data.dataEmissao ? new Date(data.dataEmissao) : null,
      valor: Number(data.valor) || 0,
    },
  });
  await prisma.desoneracaoEvento.create({
    data: { desoneracaoId: id, acao: 'NF_ADICIONADA', descricao: `NF ${data.tipo} ${data.numero} adicionada`, byUserId: user.id },
  });
  return n;
}

export async function validarNota(user, notaId) {
  const n = await prisma.desoneracaoNota.update({
    where: { id: notaId },
    data: { validada: true, validadaAt: new Date(), validadaPorId: user.id },
  });
  await prisma.desoneracaoEvento.create({
    data: { desoneracaoId: n.desoneracaoId, acao: 'NF_VALIDADA', descricao: `NF ${n.numero} validada`, byUserId: user.id },
  });
  return n;
}

export async function anexarOficialNota(user, notaId, { name, mime, bytes }) {
  if (!bytes) { const e = new Error('Arquivo obrigatório'); e.status = 400; throw e; }
  const n = await prisma.desoneracaoNota.update({
    where: { id: notaId },
    data: { oficialNome: name, oficialMime: mime, oficialBytes: bytes },
  });
  await prisma.desoneracaoEvento.create({
    data: { desoneracaoId: n.desoneracaoId, acao: 'NF_OFICIAL_ANEXADA', descricao: `NF ${n.numero}: ${name}`, byUserId: user.id },
  });
  return { id: n.id };
}

export async function getOficialNota(notaId) {
  const n = await prisma.desoneracaoNota.findUnique({ where: { id: notaId } });
  if (!n || !n.oficialBytes) { const e = new Error('NF oficial não encontrada'); e.status = 404; throw e; }
  return { name: n.oficialNome || 'nf.pdf', mime: n.oficialMime || 'application/pdf', bytes: n.oficialBytes };
}

export async function removeNota(user, notaId) {
  const n = await prisma.desoneracaoNota.findUnique({ where: { id: notaId } });
  if (!n) { const e = new Error('Não encontrada'); e.status = 404; throw e; }
  await prisma.desoneracaoNota.delete({ where: { id: notaId } });
  await prisma.desoneracaoEvento.create({
    data: { desoneracaoId: n.desoneracaoId, acao: 'NF_REMOVIDA', descricao: `NF ${n.numero} removida`, byUserId: user.id },
  });
  return { ok: true };
}

// === Documentos ===
export async function addDocumento(user, id, { tipo, name, mime, bytes }) {
  if (!bytes) { const e = new Error('Arquivo obrigatório'); e.status = 400; throw e; }
  const doc = await prisma.desoneracaoDocumento.create({
    data: { desoneracaoId: id, tipo: tipo || 'OUTRO', nome: name, mime, bytes, uploadedById: user.id },
  });
  await prisma.desoneracaoEvento.create({
    data: { desoneracaoId: id, acao: 'DOC_ANEXADO', descricao: `${tipo}: ${name}`, byUserId: user.id },
  });
  return { id: doc.id, tipo: doc.tipo, nome: doc.nome, mime: doc.mime, createdAt: doc.createdAt };
}

export async function getDocumento(docId) {
  const d = await prisma.desoneracaoDocumento.findUnique({ where: { id: docId } });
  if (!d) { const e = new Error('Documento não encontrado'); e.status = 404; throw e; }
  return { name: d.nome, mime: d.mime, bytes: d.bytes };
}

export async function removeDocumento(user, docId) {
  const d = await prisma.desoneracaoDocumento.findUnique({ where: { id: docId } });
  if (!d) { const e = new Error('Não encontrado'); e.status = 404; throw e; }
  await prisma.desoneracaoDocumento.delete({ where: { id: docId } });
  await prisma.desoneracaoEvento.create({
    data: { desoneracaoId: d.desoneracaoId, acao: 'DOC_REMOVIDO', descricao: `${d.tipo}: ${d.nome}`, byUserId: user.id },
  });
  return { ok: true };
}

// === Config docs obrigatórios (gerenciada em Parâmetros) ===
export async function listDocConfigs() {
  return prisma.desoneracaoDocConfig.findMany({ orderBy: [{ etapa: 'asc' }, { sort: 'asc' }] });
}
export async function upsertDocConfig({ modal, etapa, tipoDocumento, obrigatorio = true, sort = 0 }) {
  if (!modal || !etapa || !tipoDocumento) throw new Error('modal/etapa/tipoDocumento obrigatórios');
  return prisma.desoneracaoDocConfig.upsert({
    where: { modal_etapa_tipoDocumento: { modal, etapa, tipoDocumento } },
    create: { modal, etapa, tipoDocumento, obrigatorio: !!obrigatorio, sort: Number(sort) || 0 },
    update: { obrigatorio: !!obrigatorio, sort: Number(sort) || 0 },
  });
}
export async function removeDocConfig(id) {
  await prisma.desoneracaoDocConfig.delete({ where: { id } });
  return { ok: true };
}

// Helper público pra UI: lista os documentos esperados em cada etapa pra um modal.
export async function getRequiredDocsForUI(modal) {
  const stepsComDoc = ['DOCS_DESPACHANTE','EMISSAO_DMI','PROTOCOLO_ICMS'];
  const out = {};
  for (const e of stepsComDoc) {
    out[e] = await getRequiredDocs(modal, e);
  }
  return out;
}

export const META = { STEPS: STEPS_ORDER, DEFAULT_DOCS_BY_STEP };
