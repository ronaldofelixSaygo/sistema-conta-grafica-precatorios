// =====================================================================
// Desonerações — CRUD + transições de etapa + aprovação que gera movimentação.
//
// Fluxo (após aquisição via Solicitação de Créditos):
//   DOCS_DESPACHANTE → EMISSAO_DMI → EMISSAO_NF → VALIDACAO_NF →
//   ENVIO_NF_OFICIAL → PROTOCOLO_ICMS → (AGUARDANDO_APROVACAO) → CONCLUIDA
//
// Multi-actor: cada etapa tem um responsável determinado pela DesoneracaoStepConfig
// (CLIENTE / PARCEIRO_KIND / CLIENTE_OU_PARCEIRO / SAYGO). Auto-vínculo:
//   - DOCS_DESPACHANTE → cliente.despachanteId (se houver) ou cliente
//   - EMISSAO_DMI, VALIDACAO_NF, PROTOCOLO_ICMS → parceiro com nome = cliente.escritorio
//   - EMISSAO_NF, ENVIO_NF_OFICIAL → cliente (não tem parceiroId)
// =====================================================================
import { prisma } from '../config/prisma.js';

// Defaults da config de responsáveis por etapa (semeadas no boot).
const STEP_CONFIG_DEFAULTS = [
  { etapa: 'DOCS_DESPACHANTE', responsavelTipo: 'CLIENTE_OU_PARCEIRO', kindCode: 'DESPACHANTE', label: 'Cliente ou Despachante', sort: 1 },
  { etapa: 'EMISSAO_DMI',      responsavelTipo: 'PARCEIRO_KIND',       kindCode: 'ESCRITORIO',  label: 'Escritório',              sort: 2 },
  { etapa: 'EMISSAO_NF',       responsavelTipo: 'CLIENTE',             kindCode: null,          label: 'Cliente',                 sort: 3 },
  { etapa: 'VALIDACAO_NF',     responsavelTipo: 'PARCEIRO_KIND',       kindCode: 'ESCRITORIO',  label: 'Escritório',              sort: 4 },
  { etapa: 'ENVIO_NF_OFICIAL', responsavelTipo: 'CLIENTE',             kindCode: null,          label: 'Cliente',                 sort: 5 },
  { etapa: 'PROTOCOLO_ICMS',   responsavelTipo: 'PARCEIRO_KIND',       kindCode: 'ESCRITORIO',  label: 'Escritório',              sort: 6 },
];

let _stepConfigEnsured = false;
async function ensureStepConfigDefaults() {
  if (_stepConfigEnsured) return;
  try {
    for (const cfg of STEP_CONFIG_DEFAULTS) {
      await prisma.desoneracaoStepConfig.upsert({
        where: { etapa: cfg.etapa },
        create: cfg,
        update: {}, // não sobrescreve config customizada
      });
    }
    _stepConfigEnsured = true;
  } catch (e) {
    console.warn('[desoneracoes] seed stepConfig falhou:', e.message);
  }
}

export async function listStepConfigs() {
  await ensureStepConfigDefaults();
  return prisma.desoneracaoStepConfig.findMany({ orderBy: { sort: 'asc' } });
}
export async function getStepConfig(etapa) {
  await ensureStepConfigDefaults();
  return prisma.desoneracaoStepConfig.findUnique({ where: { etapa } });
}
export async function upsertStepConfig({ etapa, responsavelTipo, kindCode, label, sort }) {
  if (!etapa) throw new Error('Etapa obrigatória');
  const valid = ['CLIENTE','PARCEIRO_KIND','CLIENTE_OU_PARCEIRO','SAYGO'];
  if (!valid.includes(responsavelTipo)) throw new Error('Tipo de responsável inválido');
  return prisma.desoneracaoStepConfig.upsert({
    where: { etapa },
    create: { etapa, responsavelTipo, kindCode: kindCode || null, label: label || null, sort: Number(sort) || 0 },
    update: { responsavelTipo, kindCode: kindCode || null, label: label || null, sort: Number(sort) || 0 },
  });
}

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

export async function listDesoneracoes(user, filters = {}) {
  const where = {};
  if (filters.clienteId) where.clienteId = Number(filters.clienteId);
  if (filters.status) where.status = filters.status;
  if (filters.currentStep) where.currentStep = filters.currentStep;
  if (filters.from) where.createdAt = { ...(where.createdAt || {}), gte: new Date(filters.from) };
  if (filters.to)   where.createdAt = { ...(where.createdAt || {}), lte: new Date(filters.to) };
  if (filters.parceiroId) {
    where.steps = { some: { parceiroId: filters.parceiroId } };
  }

  // Scope por papel:
  // - CLIENT: só do próprio cliente
  // - PARTNER ESCRITORIO: clientes vinculados ao escritório dele (cliente.escritorio = user.officeName)
  // - PARTNER DESPACHANTE (ou qualquer kind não-Escritório): processos onde aparece em alguma etapa
  // - SAYGO/ADM: tudo
  if (user) {
    if (user.role === 'CLIENT' && user.clienteId) {
      where.clienteId = user.clienteId;
    } else if (user.role === 'PARTNER') {
      const isEscritorio = (user.partnerKindCode || user.partnerType) === 'ESCRITORIO';
      if (isEscritorio) {
        const escNome = user.officeName || user.parceiroNome;
        if (escNome) where.cliente = { is: { escritorio: escNome } };
        else where.id = '__none__'; // nenhum
      } else if (user.parceiroId) {
        // Despachante ou outros: vê desonerações onde é responsável de alguma etapa
        const existingSteps = where.steps || {};
        where.steps = { some: { ...((existingSteps && existingSteps.some) || {}), parceiroId: user.parceiroId } };
      } else {
        where.id = '__none__';
      }
    }
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

export async function getDesoneracao(id, user = null) {
  const r = await prisma.desoneracao.findUnique({
    where: { id },
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true, cnpj: true, despachanteId: true } },
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

  // Anexa configs das etapas + flag "podeAtuar" pra cada etapa (se user fornecido)
  await ensureStepConfigDefaults();
  const configs = await prisma.desoneracaoStepConfig.findMany();
  const cfgByEtapa = new Map(configs.map(c => [c.etapa, c]));
  r.steps = await Promise.all(r.steps.map(async (s) => {
    const cfg = cfgByEtapa.get(s.etapa) || null;
    let podeAtuar = false;
    if (user) {
      const auth = await canActOnStep(user, r, s);
      podeAtuar = auth.ok;
    }
    return { ...s, config: cfg, podeAtuar };
  }));
  return r;
}

// Resolve automaticamente o parceiro responsável de cada etapa com base no
// cliente (despachante associado + escritório vinculado pelo nome).
async function resolveDefaultParceirosForCliente(cliente) {
  // Escritório: busca parceiro com nome = cliente.escritorio (kindCode preferencial ESCRITORIO)
  let escritorioParceiroId = null;
  if (cliente.escritorio) {
    const escritorio = await prisma.parceiro.findFirst({
      where: {
        nome: cliente.escritorio,
        active: true,
        OR: [{ kindCode: 'ESCRITORIO' }, { type: 'ESCRITORIO' }],
      },
      select: { id: true },
    });
    escritorioParceiroId = escritorio?.id || null;
  }
  return {
    DOCS_DESPACHANTE: cliente.despachanteId || null, // pode ser null → cliente assume
    EMISSAO_DMI:      escritorioParceiroId,
    EMISSAO_NF:       null, // cliente
    VALIDACAO_NF:     escritorioParceiroId,
    ENVIO_NF_OFICIAL: null, // cliente
    PROTOCOLO_ICMS:   escritorioParceiroId,
  };
}

export async function createDesoneracao(user, data) {
  if (!data.clienteId) { const e = new Error('clienteId obrigatório'); e.status = 400; throw e; }
  if (!data.modal || !['MARITIMO','AEREO','RODOVIARIO'].includes(data.modal)) {
    const e = new Error('Modal de transporte obrigatório'); e.status = 400; throw e;
  }
  const cliente = await prisma.cliente.findUnique({ where: { id: Number(data.clienteId) } });
  if (!cliente) { const e = new Error('Cliente não encontrado'); e.status = 404; throw e; }
  await ensureStepConfigDefaults();

  // Auto-vínculo dos parceiros com base no cadastro do cliente.
  // Overrides explícitos (data.parceiros[etapa]) têm prioridade.
  const autoParceiros = await resolveDefaultParceirosForCliente(cliente);
  const finalParceiros = { ...autoParceiros, ...(data.parceiros || {}) };

  // Valida que toda etapa onde o responsável NÃO é CLIENTE tem parceiro definido.
  const configs = await prisma.desoneracaoStepConfig.findMany();
  const cfgByEtapa = new Map(configs.map(c => [c.etapa, c]));
  const erros = [];
  for (const etapa of STEPS_ORDER.filter(s => s !== 'CONCLUIDO')) {
    const cfg = cfgByEtapa.get(etapa);
    if (!cfg) continue;
    // CLIENTE-only: não precisa de parceiroId
    if (cfg.responsavelTipo === 'CLIENTE') continue;
    // CLIENTE_OU_PARCEIRO: parceiro é opcional (cliente assume se faltar)
    if (cfg.responsavelTipo === 'CLIENTE_OU_PARCEIRO') continue;
    // PARCEIRO_KIND / SAYGO: exige parceiro definido
    if (cfg.responsavelTipo === 'PARCEIRO_KIND' && !finalParceiros[etapa]) {
      erros.push(`Parceiro responsável obrigatório na etapa ${etapa} (${cfg.label || cfg.kindCode})`);
    }
  }
  if (erros.length) {
    const msg = erros.join('; ') + '. Cadastre o escritório do cliente e o despachante (em Clientes) antes de criar a desoneração.';
    const e = new Error(msg); e.status = 400; throw e;
  }

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
    const stepsToCreate = STEPS_ORDER.filter(s => s !== 'CONCLUIDO').map(etapa => ({
      desoneracaoId: d.id,
      etapa,
      parceiroId: finalParceiros[etapa] || null,
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

// Checa se um user pode atuar numa etapa específica. Retorna { ok, motivo }.
export async function canActOnStep(user, desoneracao, step) {
  // ADM e SAYGO podem tudo (override administrativo)
  if (user.role === 'ADM' || user.role === 'SAYGO') return { ok: true };
  await ensureStepConfigDefaults();
  const cfg = await prisma.desoneracaoStepConfig.findUnique({ where: { etapa: step.etapa } });
  if (!cfg) return { ok: false, motivo: 'Configuração da etapa não encontrada' };

  const isCliente = user.role === 'CLIENT' && user.clienteId === desoneracao.clienteId;
  const userPartnerKind = user.partnerKindCode || user.partnerType || null;
  const isParceiroDaEtapa = step.parceiroId && user.parceiroId === step.parceiroId;
  const isParceiroDoKind  = userPartnerKind && cfg.kindCode && userPartnerKind === cfg.kindCode;

  if (cfg.responsavelTipo === 'CLIENTE') {
    return isCliente
      ? { ok: true }
      : { ok: false, motivo: 'Apenas o cliente desse processo pode avançar esta etapa' };
  }
  if (cfg.responsavelTipo === 'PARCEIRO_KIND') {
    if (!step.parceiroId) return { ok: false, motivo: 'Parceiro responsável não definido nesta etapa' };
    return (isParceiroDoKind && isParceiroDaEtapa)
      ? { ok: true }
      : { ok: false, motivo: `Apenas o parceiro do tipo ${cfg.kindCode} vinculado a esta etapa pode avançar` };
  }
  if (cfg.responsavelTipo === 'CLIENTE_OU_PARCEIRO') {
    // Cliente sempre pode. Parceiro do kind também, se vinculado.
    if (isCliente) return { ok: true };
    if (isParceiroDoKind && isParceiroDaEtapa) return { ok: true };
    // Se a etapa não tem parceiro vinculado, o cliente assume — então parceiro não pode mexer
    if (!step.parceiroId) return { ok: false, motivo: 'Apenas o cliente pode avançar (não há parceiro vinculado a esta etapa)' };
    return { ok: false, motivo: 'Sem permissão pra atuar nesta etapa' };
  }
  if (cfg.responsavelTipo === 'SAYGO') {
    return { ok: false, motivo: 'Apenas Saygo/Admin pode avançar esta etapa' };
  }
  return { ok: false, motivo: 'Tipo de responsável desconhecido' };
}

// Avança a etapa atual. Valida obrigatoriedades (docs/NFs) e autorização do user.
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
  const stepObj = cur.steps.find(s => s.etapa === etapaAtual);

  // Autorização do user pra atuar nessa etapa
  const auth = await canActOnStep(user, cur, stepObj || { etapa: etapaAtual, parceiroId: null });
  if (!auth.ok) { const e = new Error(auth.motivo); e.status = 403; throw e; }

  // === Validações específicas por etapa ===
  const tipos = new Set(cur.documentos.map(d => d.tipo));

  // Docs obrigatórios pra etapa atual
  const obrigatorios = await getRequiredDocs(cur.modal, etapaAtual);
  const faltando = obrigatorios.filter(t => !tipos.has(t));
  if (faltando.length) {
    const e = new Error(`Documentos obrigatórios faltando: ${faltando.join(', ')}`);
    e.status = 400; throw e;
  }

  // EMISSAO_DMI: precisa preencher valor ICMS desonerado antes de avançar.
  if (etapaAtual === 'EMISSAO_DMI') {
    if (!cur.valorIcmsDesonerado || cur.valorIcmsDesonerado <= 0) {
      const e = new Error('Informe o Valor ICMS a desonerar (vem da DMI devolvida pelo escritório) antes de avançar');
      e.status = 400; throw e;
    }
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

// Tabela de qual etapa habilita qual ação. Backend valida + frontend usa pra UX.
const ETAPA_DOC_TIPOS = {
  DOCS_DESPACHANTE: ['DUIMP','PL','PI','AFRMM','BL','CCT','OUTRO'],
  EMISSAO_DMI:      ['DMI','OUTRO'],
  EMISSAO_NF:       ['OUTRO'],
  VALIDACAO_NF:     ['OUTRO'],
  ENVIO_NF_OFICIAL: ['OUTRO'],
  PROTOCOLO_ICMS:   ['DESPACHO','OUTRO'],
};
export function getTiposDocPermitidos(etapa) {
  return ETAPA_DOC_TIPOS[etapa] || ['OUTRO'];
}

// === Notas Fiscais ===
export async function addNota(user, id, data) {
  const cur = await prisma.desoneracao.findUnique({ where: { id } });
  if (!cur) { const e = new Error('Desoneração não encontrada'); e.status = 404; throw e; }
  if (cur.currentStep !== 'EMISSAO_NF') {
    const e = new Error('Notas Fiscais só podem ser cadastradas na etapa "Emissão NFs" (após a DMI ser devolvida pelo escritório).');
    e.status = 400; throw e;
  }
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
  const cur = await prisma.desoneracaoNota.findUnique({ where: { id: notaId }, include: { desoneracao: true } });
  if (!cur) { const e = new Error('NF não encontrada'); e.status = 404; throw e; }
  if (cur.desoneracao.currentStep !== 'VALIDACAO_NF') {
    const e = new Error('Validação só pode ser feita na etapa "Validação NFs"');
    e.status = 400; throw e;
  }
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
  const cur = await prisma.desoneracaoNota.findUnique({ where: { id: notaId }, include: { desoneracao: true } });
  if (!cur) { const e = new Error('NF não encontrada'); e.status = 404; throw e; }
  if (cur.desoneracao.currentStep !== 'ENVIO_NF_OFICIAL') {
    const e = new Error('PDF oficial da NF só pode ser anexado na etapa "NFs Oficiais"');
    e.status = 400; throw e;
  }
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
  const cur = await prisma.desoneracao.findUnique({ where: { id }, select: { currentStep: true, status: true } });
  if (!cur) { const e = new Error('Desoneração não encontrada'); e.status = 404; throw e; }
  if (cur.status !== 'EM_ANDAMENTO') {
    const e = new Error('Não é possível anexar documentos com a desoneração nesse status'); e.status = 400; throw e;
  }
  const permitidos = getTiposDocPermitidos(cur.currentStep);
  const tipoFinal = tipo || 'OUTRO';
  if (!permitidos.includes(tipoFinal)) {
    const e = new Error(`Documento "${tipoFinal}" não é esperado nesta etapa. Permitidos: ${permitidos.join(', ')}`);
    e.status = 400; throw e;
  }
  const doc = await prisma.desoneracaoDocumento.create({
    data: { desoneracaoId: id, tipo: tipoFinal, nome: name, mime, bytes, uploadedById: user.id },
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

export const META = { STEPS: STEPS_ORDER, DEFAULT_DOCS_BY_STEP, ETAPA_DOC_TIPOS };
