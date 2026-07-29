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
import * as storage from './storage.service.js';
import * as email from './email.service.js';
import * as invoiceAi from './invoice/invoiceAi.service.js';

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
// =====================================================================
// Tipos de documento (cadastráveis). Antes hardcoded em código.
// =====================================================================
const DOC_TIPOS_BUILTIN = [
  { code: 'DUIMP',          label: 'DUIMP — Extrato da Declaração Única', sort: 1 },
  { code: 'DI',             label: 'DI — Extrato da Declaração de Importação', sort: 2 },
  { code: 'DI_JUSTIFICATIVA', label: 'DI — Declaração de Justificativa',  sort: 3 },
  { code: 'PL',             label: 'PL — Packing List',                   sort: 4 },
  { code: 'PI',             label: 'PI — Proforma Invoice / Commercial Invoice', sort: 5 },
  { code: 'AFRMM',          label: 'AFRMM — Comprovante AFRMM',           sort: 6 },
  { code: 'CTE_AWB_BL',     label: 'Conhecimento de Transporte (CTE/AWB/BL)', sort: 7 },
  { code: 'DMI',            label: 'DMI — Documento de Movimentação Interna', sort: 8 },
  { code: 'DESPACHO',       label: 'Despacho ICMS',                       sort: 9 },
  { code: 'CONTA_GRAFICA',  label: 'Conta Gráfica atualizada',            sort: 10 },
];
// Tipos legados: marcamos inativos pra não aparecer em selects, mas documentos
// já anexados com esses tipos continuam acessíveis (são histórico).
const DOC_TIPOS_LEGACY = ['BL','CCT'];

let _docTiposEnsured = false;
async function ensureDocTiposBuiltin() {
  if (_docTiposEnsured) return;
  try {
    for (const t of DOC_TIPOS_BUILTIN) {
      await prisma.desoneracaoDocTipo.upsert({
        where: { code: t.code },
        create: { ...t, isBuiltin: true, active: true },
        update: {}, // não sobrescreve edições do admin (label etc.)
      });
    }
    for (const code of DOC_TIPOS_LEGACY) {
      await prisma.desoneracaoDocTipo.upsert({
        where: { code },
        create: { code, label: `${code} (legado)`, sort: 99, isBuiltin: true, active: false },
        update: {}, // se admin reativar, respeita
      });
    }
    _docTiposEnsured = true;
  } catch (e) {
    console.warn('[desoneracoes] seed docTipos falhou:', e.message);
  }
}

export async function listDocTipos({ includeInactive = false } = {}) {
  await ensureDocTiposBuiltin();
  return prisma.desoneracaoDocTipo.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  });
}
export async function upsertDocTipo({ id, code, label, descricao, sort, active }) {
  const codeNorm = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (!codeNorm) { const e = new Error('Código obrigatório'); e.status = 400; throw e; }
  if (!label) { const e = new Error('Rótulo obrigatório'); e.status = 400; throw e; }
  const data = {
    code: codeNorm, label, descricao: descricao || null,
    sort: Number(sort) || 0, active: active !== false,
  };
  if (id) {
    return prisma.desoneracaoDocTipo.update({ where: { id }, data });
  }
  return prisma.desoneracaoDocTipo.upsert({
    where: { code: codeNorm },
    create: data, update: data,
  });
}
export async function deleteDocTipo(id) {
  const t = await prisma.desoneracaoDocTipo.findUnique({ where: { id } });
  if (!t) { const e = new Error('Não encontrado'); e.status = 404; throw e; }
  if (t.isBuiltin) {
    // Built-in não deleta, só desativa
    return prisma.desoneracaoDocTipo.update({ where: { id }, data: { active: false } });
  }
  return prisma.desoneracaoDocTipo.delete({ where: { id } });
}

export async function upsertStepConfig({ etapa, responsavelTipo, kindCode, label, sort, slaHours }) {
  if (!etapa) throw new Error('Etapa obrigatória');
  const valid = ['CLIENTE','PARCEIRO_KIND','CLIENTE_OU_PARCEIRO','SAYGO'];
  if (!valid.includes(responsavelTipo)) throw new Error('Tipo de responsável inválido');
  const slaH = slaHours != null && slaHours !== '' ? Math.max(0, Number(slaHours)) : null;
  return prisma.desoneracaoStepConfig.upsert({
    where: { etapa },
    create: {
      etapa, responsavelTipo, kindCode: kindCode || null, label: label || null,
      sort: Number(sort) || 0, ...(slaH != null && { slaHours: slaH }),
    },
    update: {
      responsavelTipo, kindCode: kindCode || null, label: label || null,
      sort: Number(sort) || 0, ...(slaH != null && { slaHours: slaH }),
    },
  });
}

// ENVIO_NF_OFICIAL foi removida do fluxo. Re-anexação de NF rejeitada
// acontece dentro da própria EMISSAO_NF (parceiro rejeita → cliente refaz na
// mesma etapa 3 → parceiro valida de novo na etapa 4 → vai pra etapa 5).
const STEPS_ORDER = [
  'DOCS_DESPACHANTE',
  'EMISSAO_DMI',
  'EMISSAO_NF',
  'VALIDACAO_NF',
  'PROTOCOLO_ICMS',
  'CONCLUIDO',
];

function nextStep(cur) {
  const i = STEPS_ORDER.indexOf(cur);
  return i < 0 || i === STEPS_ORDER.length - 1 ? null : STEPS_ORDER[i + 1];
}

// Documentos obrigatórios por etapa × modal. Padrão; pode ser sobrescrito
// pela tabela DesoneracaoDocConfig em runtime via configs do admin.
// CTE_AWB_BL unifica os antigos BL e CCT.
// Os tipos DUIMP/DI/DI_JUSTIFICATIVA são resolvidos em runtime pelo
// tipoDocImport da desoneração (ver getRequiredDocs).
const DEFAULT_DOCS_BY_STEP = {
  DOCS_DESPACHANTE: {
    TODOS:      ['PL', 'PI', 'AFRMM', 'CTE_AWB_BL'],
    MARITIMO:   ['PL', 'PI', 'AFRMM', 'CTE_AWB_BL'],
    AEREO:      ['PL', 'PI', 'AFRMM', 'CTE_AWB_BL'],
    RODOVIARIO: ['PL', 'PI', 'AFRMM', 'CTE_AWB_BL'],
  },
  EMISSAO_DMI:    { TODOS: ['DMI'] },
  PROTOCOLO_ICMS: { TODOS: ['DESPACHO', 'CONTA_GRAFICA'] },
};

// Resolve quais documentos são EXIGIDOS ao avançar uma etapa, considerando
// modal, overrides do admin e tipoDocImport (DI/DUIMP).
// MERGE: defaults sempre entram. Overrides com `obrigatorio=true` adicionam.
// Overrides com `obrigatorio=false` REMOVEM do conjunto (opt-out explícito).
// Antes overrides substituía 100% o default — daí adicionar CONTA_GRAFICA ao
// default não aparecia se já havia um config qualquer pra etapa.
async function getRequiredDocs(modal, etapa, tipoDocImport = null) {
  const overrides = await prisma.desoneracaoDocConfig.findMany({
    where: {
      etapa,
      OR: [{ modal }, { modal: 'TODOS' }],
    },
  });
  const def = DEFAULT_DOCS_BY_STEP[etapa] || {};
  const defaultDocs = def[modal] || def.TODOS || [];
  const overrideOn  = overrides.filter(o => o.obrigatorio).map(o => o.tipoDocumento);
  const overrideOff = new Set(overrides.filter(o => !o.obrigatorio).map(o => o.tipoDocumento));
  let baseDocs = [...new Set([...defaultDocs, ...overrideOn])].filter(d => !overrideOff.has(d));
  // Etapa 1 (DOCS_DESPACHANTE): adiciona DUIMP, ou DI+JUSTIFICATIVA, conforme escolha do user
  if (etapa === 'DOCS_DESPACHANTE' && tipoDocImport) {
    if (tipoDocImport === 'DI') {
      if (!baseDocs.includes('DI'))               baseDocs = ['DI', ...baseDocs];
      if (!baseDocs.includes('DI_JUSTIFICATIVA')) baseDocs = ['DI_JUSTIFICATIVA', ...baseDocs];
    } else if (tipoDocImport === 'DUIMP') {
      if (!baseDocs.includes('DUIMP'))            baseDocs = ['DUIMP', ...baseDocs];
    }
  }
  return baseDocs;
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

  // PERF: limita a 200 processos por listagem. Volume real raramente passa disso,
  // e impede pico de payload em clientes com histórico grande. Frontend pode
  // pedir mais via ?take=N e ?skip=N quando virar problema.
  const take = Math.min(Math.max(Number(filters.take) || 200, 1), 500);
  const skip = Math.max(Number(filters.skip) || 0, 0);
  // PERF: steps com `select` (sem `include`) — evita trazer campos pesados
  // tipo `notes` desnecessariamente na grade de listagem.
  // OBS: DesoneracaoStep NÃO tem campo `status` (só Kanban tem). Aqui o
  // "andamento" é inferido por completedAt/startedAt.
  return prisma.desoneracao.findMany({
    where, take, skip,
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true } },
      steps: {
        select: {
          id: true, etapa: true, startedAt: true, completedAt: true, parceiroId: true,
          parceiro: { select: { id: true, nome: true } },
        },
      },
      _count: { select: { notas: { where: { deletedAt: null } }, documentos: true } },
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
      // SELECT explicito EXCLUINDO oficialBytes (PDF inteiro). Sem isso, cada
      // NF inflava o payload em MB e travava a tela.
      notas: {
        where: { deletedAt: null },
        select: {
          id: true, tipo: true, numero: true, serie: true, dataEmissao: true, valor: true,
          validada: true, validadaAt: true, validadaPorId: true,
          rejeitada: true, rejeitadaAt: true, rejeitadaMotivo: true,
          oficialNome: true, oficialMime: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
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
  // PERF: carrega configs UMA vez e passa pra canActOnStepCached — antes o
  // canActOnStep fazia findUnique por step (N+1 brutal num modal com 6 steps).
  await ensureStepConfigDefaults();
  const configs = await prisma.desoneracaoStepConfig.findMany();
  const cfgByEtapa = new Map(configs.map(c => [c.etapa, c]));
  r.steps = r.steps.map((s) => {
    const cfg = cfgByEtapa.get(s.etapa) || null;
    const podeAtuar = user ? canActOnStepCached(user, r, s, cfg).ok : false;
    return { ...s, config: cfg, podeAtuar };
  });
  return r;
}

// Versão "sync" do canActOnStep que recebe cfg já carregado — usado pelo
// getDesoneracao pra evitar N+1.
function canActOnStepCached(user, desoneracao, step, cfg) {
  if (user.role === 'ADM' || user.role === 'SAYGO') return { ok: true };
  if (!cfg) return { ok: false, motivo: 'Configuração da etapa não encontrada' };
  const isCliente = user.role === 'CLIENT' && user.clienteId === desoneracao.clienteId;
  const userPartnerKind = user.partnerKindCode || user.partnerType || null;
  const isParceiroDaEtapa = step.parceiroId && user.parceiroId === step.parceiroId;
  const isParceiroDoKind  = userPartnerKind && cfg.kindCode && userPartnerKind === cfg.kindCode;
  if (cfg.responsavelTipo === 'CLIENTE') {
    return isCliente ? { ok: true } : { ok: false, motivo: 'Apenas o cliente desse processo pode avançar esta etapa' };
  }
  if (cfg.responsavelTipo === 'PARCEIRO_KIND') {
    if (!step.parceiroId) return { ok: false, motivo: 'Parceiro responsável não definido nesta etapa' };
    return (isParceiroDoKind && isParceiroDaEtapa) ? { ok: true } : { ok: false, motivo: `Apenas o parceiro do tipo ${cfg.kindCode} vinculado a esta etapa pode avançar` };
  }
  if (cfg.responsavelTipo === 'CLIENTE_OU_PARCEIRO') {
    if (isCliente) return { ok: true };
    if (isParceiroDoKind && isParceiroDaEtapa) return { ok: true };
    if (!step.parceiroId) return { ok: false, motivo: 'Apenas o cliente pode avançar (não há parceiro vinculado a esta etapa)' };
    return { ok: false, motivo: 'Sem permissão pra atuar nesta etapa' };
  }
  if (cfg.responsavelTipo === 'SAYGO') return { ok: false, motivo: 'Apenas Saygo/Admin pode avançar esta etapa' };
  return { ok: false, motivo: 'Tipo de responsável desconhecido' };
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
  // REGRA: só CLIENTE (do próprio cadastro) ou STAFF (ADM/SAYGO) cria desoneração.
  // Parceiros são responsáveis por etapas, não pela abertura do processo.
  const isStaff  = user.role === 'ADM' || user.role === 'SAYGO';
  const isClient = user.role === 'CLIENT';
  if (!isStaff && !isClient) {
    const e = new Error('Apenas cliente ou usuário Saygo pode criar uma desoneração');
    e.status = 403; throw e;
  }
  if (!data.clienteId) { const e = new Error('clienteId obrigatório'); e.status = 400; throw e; }
  if (!data.modal || !['MARITIMO','AEREO','RODOVIARIO'].includes(data.modal)) {
    const e = new Error('Modal de transporte obrigatório'); e.status = 400; throw e;
  }
  const cliente = await prisma.cliente.findUnique({ where: { id: Number(data.clienteId) } });
  if (!cliente) { const e = new Error('Cliente não encontrado'); e.status = 404; throw e; }
  // CLIENTE só pode criar pra si próprio
  if (isClient && cliente.id !== user.clienteId) {
    const e = new Error('Cliente só pode criar desoneração pra si próprio'); e.status = 403; throw e;
  }
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
    const tipoDocImport = data.tipoDocImport === 'DI' ? 'DI'
                        : data.tipoDocImport === 'DUIMP' ? 'DUIMP'
                        : null;
    const d = await tx.desoneracao.create({
      data: {
        clienteId: cliente.id,
        creditRequestId: data.creditRequestId || null,
        numeroProcesso: data.numeroProcesso || null,
        duimpDi: data.duimpDi || null,
        tipoDocImport,
        modal: data.modal,
        valorMercadoria: data.valorMercadoria != null ? Number(data.valorMercadoria) : null,
        valorIcmsDesonerado: data.valorIcmsDesonerado != null ? Number(data.valorIcmsDesonerado) : null,
        status: 'EM_ANDAMENTO',
        currentStep: 'DOCS_DESPACHANTE',
        createdById: user.id,
      },
    });
    const now = new Date();
    const stepsToCreate = STEPS_ORDER.filter(s => s !== 'CONCLUIDO').map(etapa => ({
      desoneracaoId: d.id,
      etapa,
      parceiroId: finalParceiros[etapa] || null,
      // Etapa inicial já começa "em andamento" pra cálculo de SLA.
      startedAt: etapa === 'DOCS_DESPACHANTE' ? now : null,
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
      // SELECT sem oficialBytes — só campos de controle
      notas: {
        where: { deletedAt: null },
        select: { id: true, tipo: true, validada: true, rejeitada: true, oficialNome: true },
      },
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
  const obrigatorios = await getRequiredDocs(cur.modal, etapaAtual, cur.tipoDocImport);
  const faltando = obrigatorios.filter(t => !tipos.has(t));
  if (faltando.length) {
    const e = new Error(`Documentos obrigatórios faltando: ${faltando.join(', ')}`);
    e.status = 400; throw e;
  }

  // EMISSAO_DMI: o valor do ICMS é LIDO automaticamente da DMI anexada
  // (campo "ICMS Comp. C/Gráfica"). Não é mais informado manualmente pelo parceiro.
  // Se a leitura falhar, o processo segue e o valor pode ser informado na aprovação.
  if (etapaAtual === 'EMISSAO_DMI') {
    try {
      const dmiDoc = await prisma.desoneracaoDocumento.findFirst({
        where: { desoneracaoId: id, tipo: 'DMI' }, orderBy: { createdAt: 'desc' },
      });
      if (dmiDoc) {
        let buf = null;
        if (dmiDoc.s3Key) { try { buf = await storage.downloadBuffer(dmiDoc.s3Key); } catch {} }
        else if (dmiDoc.bytes) buf = Buffer.from(dmiDoc.bytes);
        if (buf) {
          const val = await invoiceAi.analyzeDmiIcms(buf, dmiDoc.mime);
          if (val && val > 0) {
            await prisma.desoneracao.update({ where: { id }, data: { valorIcmsDesonerado: val } });
          }
        }
      }
    } catch (e) { console.warn('[desoneracoes] extração ICMS da DMI falhou:', e.message); }
  }
  // EMISSAO_NF: cliente precisa de pelo menos 1 entrada + 1 saída anexadas,
  // e NENHUMA NF pode estar marcada como rejeitada (cliente deve excluir e
  // substituir as rejeitadas antes de devolver pro parceiro).
  if (etapaAtual === 'EMISSAO_NF') {
    const aindaRejeitada = cur.notas.filter(n => n.rejeitada);
    if (aindaRejeitada.length) {
      const e = new Error(`${aindaRejeitada.length} NF(s) ainda marcadas como rejeitadas — exclua e anexe novas no lugar antes de avançar`);
      e.status = 400; throw e;
    }
    const temEntrada = cur.notas.some(n => n.tipo === 'ENTRADA');
    const temSaida   = cur.notas.some(n => n.tipo === 'SAIDA');
    if (!temEntrada || !temSaida) {
      const e = new Error('Anexe ao menos 1 NF de Entrada e 1 NF de Saída antes de avançar');
      e.status = 400; throw e;
    }
  }
  // VALIDACAO_NF: parceiro só avança quando:
  //  1) Não há nenhuma NF rejeitada (se há, ele deve clicar em "Devolver pro cliente")
  //  2) Todas as NFs foram validadas
  //  3) Existe pelo menos 1 entrada validada E 1 saída validada
  if (etapaAtual === 'VALIDACAO_NF') {
    const temRejeitada = cur.notas.some(n => n.rejeitada);
    if (temRejeitada) {
      const e = new Error('Há NFs rejeitadas — clique em "Devolver pro cliente" antes de avançar');
      e.status = 400; throw e;
    }
    const pendentes = cur.notas.filter(n => !n.validada);
    if (pendentes.length) {
      const e = new Error(`${pendentes.length} NF(s) sem validação — valide ou rejeite todas`);
      e.status = 400; throw e;
    }
    const entradaValidada = cur.notas.some(n => n.tipo === 'ENTRADA' && n.validada);
    const saidaValidada   = cur.notas.some(n => n.tipo === 'SAIDA'   && n.validada);
    if (!entradaValidada || !saidaValidada) {
      const e = new Error('É preciso ter ao menos 1 NF de Entrada e 1 NF de Saída validadas antes de avançar');
      e.status = 400; throw e;
    }
  }
  // EMISSAO_NF (retorno): se o cliente voltou pra etapa 3 por NFs rejeitadas,
  // ele precisa ter EXCLUÍDO ou substituído as rejeitadas antes de avançar.
  if (etapaAtual === 'EMISSAO_NF') {
    const aindaRejeitada = cur.notas.filter(n => n.rejeitada);
    if (aindaRejeitada.length) {
      const e = new Error(`${aindaRejeitada.length} NF(s) ainda marcada(s) como rejeitada — exclua e anexe novas no lugar antes de avançar`);
      e.status = 400; throw e;
    }
  }

  // === Define próxima etapa ===
  // Avanço sempre é linear agora — a "volta" pra etapa 3 é feita pelo botão
  // explícito "Devolver pro cliente" (endpoint /devolver-nfs).
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
      await tx.desoneracao.update({
        where: { id },
        data: { status: 'AGUARDANDO_APROVACAO', currentStep: 'CONCLUIDO' },
      });
    } else {
      await tx.desoneracao.update({ where: { id }, data: { currentStep: proxima } });
      await tx.desoneracaoStep.update({
        where: { desoneracaoId_etapa: { desoneracaoId: id, etapa: proxima } },
        data: { startedAt: new Date() },
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
  // Notifica próximo responsável (fire-and-forget — não bloqueia a resposta)
  setImmediate(() => {
    email.notifyDesoneracaoStepAdvance({
      desoneracaoId: id, fromStep: etapaAtual, toStep: proxima, byUser: user, motivo: notes,
    }).catch(err => console.warn('[desoneracoes] notify step falhou:', err.message));
  });
  return getDesoneracao(id);
}

// Aprovação final: gera Movimentação e marca status CONCLUIDA.
// Permitida pra STAFF (ADM/SAYGO) ou pro CLIENTE dono do processo.
// Parceiro/despachante NÃO aprova — ele só conclui as etapas.
export async function approveAndCreateMovimentacao(user, id, { valorIcmsManual } = {}) {
  const d = await prisma.desoneracao.findUnique({
    where: { id },
    include: { cliente: true, steps: { include: { parceiro: true } } },
  });
  if (!d) { const e = new Error('Desoneração não encontrada'); e.status = 404; throw e; }
  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  const isOwnerClient = user.role === 'CLIENT' && user.clienteId === d.clienteId;
  if (!isStaff && !isOwnerClient) {
    const e = new Error('Apenas Saygo ou o cliente dono pode aprovar a desoneração');
    e.status = 403; throw e;
  }
  if (d.status !== 'AGUARDANDO_APROVACAO') {
    const e = new Error('Só é possível aprovar quando status = AGUARDANDO_APROVACAO'); e.status = 400; throw e;
  }
  if (!d.duimpDi) { const e = new Error('DUIMP/DI é obrigatório pra criar a movimentação'); e.status = 400; throw e; }
  // Valor do ICMS: normalmente já foi lido da DMI. Plano B: se não houver,
  // aceita um valor informado manualmente na aprovação (não trava o processo).
  if (!d.valorIcmsDesonerado || d.valorIcmsDesonerado <= 0) {
    if (valorIcmsManual != null && Number(valorIcmsManual) > 0) {
      const v = Math.round(Number(valorIcmsManual) * 100) / 100;
      await prisma.desoneracao.update({ where: { id }, data: { valorIcmsDesonerado: v } });
      d.valorIcmsDesonerado = v;
    } else {
      const e = new Error('Não foi possível ler o "ICMS Comp. C/Gráfica" da DMI. Informe o valor manualmente para concluir.');
      e.status = 400; throw e;
    }
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
  // REGRA: só STAFF (ADM/SAYGO) ou o próprio CLIENTE dono do processo pode cancelar.
  // Parceiro responsável por etapa NÃO pode cancelar o processo como um todo.
  const isStaff  = user.role === 'ADM' || user.role === 'SAYGO';
  const isOwnerClient = user.role === 'CLIENT' && user.clienteId === cur.clienteId;
  if (!isStaff && !isOwnerClient) {
    const e = new Error('Apenas cliente ou usuário Saygo pode cancelar uma desoneração');
    e.status = 403; throw e;
  }
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
// CTE_AWB_BL é o tipo unificado novo; BL/CCT são legados mas continuam aceitos
// pra retrocompat com documentos já anexados antes da unificação.
const ETAPA_DOC_TIPOS = {
  DOCS_DESPACHANTE: ['DUIMP','DI','DI_JUSTIFICATIVA','PL','PI','AFRMM','CTE_AWB_BL','BL','CCT','OUTRO'],
  EMISSAO_DMI:      ['DMI','OUTRO'],
  EMISSAO_NF:       ['OUTRO'],
  VALIDACAO_NF:     ['OUTRO'],
  ENVIO_NF_OFICIAL: ['OUTRO'],
  PROTOCOLO_ICMS:   ['DESPACHO','CONTA_GRAFICA','OUTRO'],
};
export function getTiposDocPermitidos(etapa) {
  return ETAPA_DOC_TIPOS[etapa] || ['OUTRO'];
}
// Inverso: dado um tipo de documento, em qual etapa ele pertence?
function etapaDoTipo(tipo) {
  for (const [etapa, tipos] of Object.entries(ETAPA_DOC_TIPOS)) {
    if (tipos.includes(tipo) && tipo !== 'OUTRO') return etapa;
  }
  return null;
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
  if (!cur || cur.deletedAt) { const e = new Error('NF não encontrada'); e.status = 404; throw e; }
  if (cur.desoneracao.currentStep !== 'VALIDACAO_NF') {
    const e = new Error('Validação só pode ser feita na etapa "Validação NFs"');
    e.status = 400; throw e;
  }
  const n = await prisma.desoneracaoNota.update({
    where: { id: notaId },
    data: { validada: true, validadaAt: new Date(), validadaPorId: user.id, rejeitada: false, rejeitadaAt: null },
  });
  await prisma.desoneracaoEvento.create({
    data: { desoneracaoId: n.desoneracaoId, acao: 'NF_VALIDADA', descricao: `NF ${n.numero} validada`, byUserId: user.id },
  });
  return n;
}

// Rejeita uma NF — disponível na etapa VALIDACAO_NF. Quando há ao menos
// uma NF rejeitada e o parceiro avança, o fluxo passa por ENVIO_NF_OFICIAL
// pra o cliente re-anexar as rejeitadas.
// Rejeitar uma NF — disponível na etapa VALIDACAO_NF.
// Side effect importante: ao rejeitar, o processo VOLTA AUTOMATICAMENTE pra
// EMISSAO_NF pra o cliente substituir o arquivo. Não precisa de botão extra.
export async function rejeitarNota(user, notaId, motivo) {
  const cur = await prisma.desoneracaoNota.findUnique({ where: { id: notaId }, include: { desoneracao: true } });
  if (!cur || cur.deletedAt) { const e = new Error('NF não encontrada'); e.status = 404; throw e; }
  if (cur.desoneracao.currentStep !== 'VALIDACAO_NF') {
    const e = new Error('Rejeição só pode ser feita na etapa "Validação NFs"');
    e.status = 400; throw e;
  }
  const desoneracaoId = cur.desoneracaoId;
  await prisma.$transaction(async (tx) => {
    // 1) Marca a NF como rejeitada
    await tx.desoneracaoNota.update({
      where: { id: notaId },
      data: {
        rejeitada: true, rejeitadaAt: new Date(), rejeitadaMotivo: motivo || null,
        validada: false, validadaAt: null, validadaPorId: null,
      },
    });
    // 2) Volta o processo pra EMISSAO_NF (cliente substitui o arquivo)
    await tx.desoneracaoStep.update({
      where: { desoneracaoId_etapa: { desoneracaoId, etapa: 'VALIDACAO_NF' } },
      data: { completedAt: null, startedAt: null, notes: 'Devolvido — NF rejeitada' },
    });
    await tx.desoneracaoStep.update({
      where: { desoneracaoId_etapa: { desoneracaoId, etapa: 'EMISSAO_NF' } },
      data: { completedAt: null, completedById: null, startedAt: new Date() },
    });
    await tx.desoneracao.update({ where: { id: desoneracaoId }, data: { currentStep: 'EMISSAO_NF' } });
    // 3) Evento de auditoria
    await tx.desoneracaoEvento.create({
      data: {
        desoneracaoId, etapa: 'VALIDACAO_NF', acao: 'NF_REJEITADA',
        descricao: `NF ${cur.tipo === 'SAIDA' ? 'de Saída' : 'de Entrada'} ${cur.oficialNome || cur.numero} rejeitada${motivo?': '+motivo:''} — devolvido pro cliente`,
        byUserId: user.id,
      },
    });
  });
  return { ok: true, currentStep: 'EMISSAO_NF' };
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

// Retorna ou os bytes (legado) OU uma URL assinada do S3 (novos). O caller
// (controller) decide: se vier `redirectUrl`, faz 302; senão, envia os bytes.
export async function getOficialNota(notaId, opts = {}) {
  const n = await prisma.desoneracaoNota.findUnique({
    where: { id: notaId },
    select: { oficialBytes: true, oficialS3Key: true, oficialNome: true, oficialMime: true, deletedAt: true },
  });
  if (!n || n.deletedAt) { const e = new Error('NF oficial não encontrada'); e.status = 404; throw e; }
  const inline = !opts.download;
  if (n.oficialS3Key) {
    const url = await storage.getDownloadUrl(n.oficialS3Key, { filename: n.oficialNome, inline });
    return { redirectUrl: url };
  }
  if (!n.oficialBytes) { const e = new Error('NF oficial não encontrada'); e.status = 404; throw e; }
  return { name: n.oficialNome || 'nf.pdf', mime: n.oficialMime || 'application/pdf', bytes: n.oficialBytes, _inline: inline };
}

export async function removeNota(user, notaId) {
  const n = await prisma.desoneracaoNota.findUnique({
    where: { id: notaId }, include: { desoneracao: true },
  });
  if (!n) { const e = new Error('Não encontrada'); e.status = 404; throw e; }
  if (n.deletedAt) { const e = new Error('NF já excluída'); e.status = 400; throw e; }
  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  if (!isStaff && n.desoneracao.currentStep !== 'EMISSAO_NF') {
    const e = new Error('Só pode excluir NF enquanto a etapa "Emissão NFs" estiver em andamento'); e.status = 400; throw e;
  }
  // SOFT DELETE no banco. O objeto no S3 fica preservado por enquanto pra não
  // perder trilha (delete físico só rodaria via job de retenção futuro).
  await prisma.desoneracaoNota.update({
    where: { id: notaId },
    data: { deletedAt: new Date(), deletedById: user.id },
  });
  // Descrição detalhada pra ficar bom no Histórico
  const tipoLabel = n.tipo === 'SAIDA' ? 'NF-S' : 'NF-E';
  const arquivo = n.oficialNome || n.numero;
  const motivo = n.rejeitada && n.rejeitadaMotivo ? ` (havia sido rejeitada — motivo: ${n.rejeitadaMotivo})` : '';
  await prisma.desoneracaoEvento.create({
    data: {
      desoneracaoId: n.desoneracaoId, acao: 'NF_REMOVIDA',
      descricao: `${tipoLabel} excluída: ${arquivo}${motivo}`,
      byUserId: user.id,
    },
  });
  return { ok: true };
}

// Upload simplificado: cliente sobe um arquivo e o sistema cria a NF com
// número = nome do arquivo (sem mais prompts pra digitar tipo/data/valor).
// O parceiro valida visualizando o arquivo na etapa de Validação.
export async function uploadNota(user, id, file, tipo) {
  if (!file) { const e = new Error('Arquivo não enviado'); e.status = 400; throw e; }
  // Tipo OBRIGATÓRIO — sem fallback default pra evitar marcar NF de saída como
  // entrada (e quebrar a validação de avanço "1 entrada + 1 saída").
  if (!tipo) {
    const e = new Error('Tipo da NF não foi enviado pelo frontend (entrada ou saída). Atualize a página (Ctrl+Shift+R) e tente de novo.');
    e.status = 400; throw e;
  }
  const tipoNorm = String(tipo).toUpperCase();
  if (!['ENTRADA','SAIDA'].includes(tipoNorm)) {
    const e = new Error("Tipo da NF deve ser ENTRADA ou SAIDA"); e.status = 400; throw e;
  }
  const cur = await prisma.desoneracao.findUnique({
    where: { id }, include: { notas: { where: { deletedAt: null }, select: { rejeitada: true } } },
  });
  if (!cur) { const e = new Error('Desoneração não encontrada'); e.status = 404; throw e; }
  if (cur.currentStep !== 'EMISSAO_NF') {
    const e = new Error('NFs só podem ser anexadas na etapa "Emissão NFs". Se houver NFs rejeitadas, o parceiro precisa devolver pro cliente primeiro.');
    e.status = 400; throw e;
  }
  // Se S3 está configurado, sobe pro bucket e grava só a key (banco fica leve).
  // Senão, fallback pra Bytes inline (retrocompat).
  let oficialS3Key = null;
  let oficialBytes = null;
  if (storage.isEnabled()) {
    const key = storage.buildKey('desoneracoes', [id, 'notas'], file.originalname);
    await storage.uploadBuffer({
      key, buffer: file.buffer, contentType: file.mimetype,
      contentDisposition: `inline; filename="${encodeURIComponent(file.originalname)}"`,
    });
    oficialS3Key = key;
  } else {
    oficialBytes = file.buffer;
  }
  const n = await prisma.desoneracaoNota.create({
    data: {
      desoneracaoId: id,
      tipo: tipoNorm,
      numero: file.originalname,
      valor: 0,
      oficialNome: file.originalname,
      oficialMime: file.mimetype,
      oficialBytes,
      oficialS3Key,
    },
  });
  await prisma.desoneracaoEvento.create({
    data: { desoneracaoId: id, acao: 'NF_ANEXADA', descricao: `NF ${tipoNorm} anexada: ${file.originalname}`, byUserId: user.id },
  });
  return { id: n.id, numero: n.numero, oficialNome: n.oficialNome, tipo: n.tipo };
}

// Devolve explicitamente o processo pro cliente (etapa 4 → etapa 3).
// Usado quando parceiro rejeitou NFs e quer devolver pro cliente refazer.
export async function devolverNfsCliente(user, id) {
  const cur = await prisma.desoneracao.findUnique({
    where: { id },
    include: { notas: { where: { deletedAt: null }, select: { rejeitada: true } } },
  });
  if (!cur) { const e = new Error('Desoneração não encontrada'); e.status = 404; throw e; }
  if (cur.currentStep !== 'VALIDACAO_NF') {
    const e = new Error('Só dá pra devolver durante a etapa "Validação NFs"'); e.status = 400; throw e;
  }
  const temRejeitada = cur.notas.some(n => n.rejeitada);
  if (!temRejeitada) {
    const e = new Error('Não há NFs rejeitadas pra devolver'); e.status = 400; throw e;
  }
  await prisma.$transaction(async (tx) => {
    // Reseta etapa 4 (não foi concluída)
    await tx.desoneracaoStep.update({
      where: { desoneracaoId_etapa: { desoneracaoId: id, etapa: 'VALIDACAO_NF' } },
      data: { completedAt: null, startedAt: null, notes: 'Devolvido — NFs rejeitadas' },
    });
    // Reabre a etapa 3 (limpa completedAt + novo startedAt)
    await tx.desoneracaoStep.update({
      where: { desoneracaoId_etapa: { desoneracaoId: id, etapa: 'EMISSAO_NF' } },
      data: { completedAt: null, completedById: null, startedAt: new Date() },
    });
    await tx.desoneracao.update({ where: { id }, data: { currentStep: 'EMISSAO_NF' } });
    await tx.desoneracaoEvento.create({
      data: {
        desoneracaoId: id, etapa: 'VALIDACAO_NF', acao: 'ETAPA_DEVOLVIDA',
        descricao: `Devolvido pro cliente — NFs rejeitadas (por ${user.name})`,
        byUserId: user.id,
      },
    });
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
  // S3 quando habilitado; senão fallback pra bytes inline.
  let s3Key = null;
  let bytesData = null;
  if (storage.isEnabled()) {
    const key = storage.buildKey('desoneracoes', [id, 'docs', tipoFinal], name);
    await storage.uploadBuffer({
      key, buffer: bytes, contentType: mime,
      contentDisposition: `inline; filename="${encodeURIComponent(name)}"`,
    });
    s3Key = key;
  } else {
    bytesData = bytes;
  }
  const doc = await prisma.desoneracaoDocumento.create({
    data: { desoneracaoId: id, tipo: tipoFinal, nome: name, mime, bytes: bytesData, s3Key, uploadedById: user.id },
  });
  await prisma.desoneracaoEvento.create({
    data: { desoneracaoId: id, acao: 'DOC_ANEXADO', descricao: `${tipo}: ${name}`, byUserId: user.id },
  });
  return { id: doc.id, tipo: doc.tipo, nome: doc.nome, mime: doc.mime, createdAt: doc.createdAt };
}

export async function getDocumento(docId, opts = {}) {
  const d = await prisma.desoneracaoDocumento.findUnique({
    where: { id: docId },
    select: { nome: true, mime: true, bytes: true, s3Key: true },
  });
  if (!d) { const e = new Error('Documento não encontrado'); e.status = 404; throw e; }
  const inline = !opts.download;
  if (d.s3Key) {
    const url = await storage.getDownloadUrl(d.s3Key, { filename: d.nome, inline });
    return { redirectUrl: url };
  }
  return { name: d.nome, mime: d.mime, bytes: d.bytes, _inline: inline };
}

export async function removeDocumento(user, docId) {
  const d = await prisma.desoneracaoDocumento.findUnique({
    where: { id: docId }, include: { desoneracao: { include: { steps: { include: { parceiro: true } } } } },
  });
  if (!d) { const e = new Error('Não encontrado'); e.status = 404; throw e; }
  const des = d.desoneracao;
  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  if (!isStaff) {
    if (des.status !== 'EM_ANDAMENTO') {
      const e = new Error('Processo não está em andamento'); e.status = 400; throw e;
    }
    // Documento não tem campo "etapa" no schema — inferimos pelo tipo via
    // ETAPA_DOC_TIPOS. Só permite excluir se o tipo pertence à etapa atual.
    const etapaDoDoc = etapaDoTipo(d.tipo);
    if (etapaDoDoc && etapaDoDoc !== des.currentStep) {
      const e = new Error('Só dá pra excluir documento da etapa atual'); e.status = 400; throw e;
    }
    const curStep = des.steps.find(s => s.etapa === des.currentStep);
    const podeAtuar = await canActOnStep(user, des, curStep);
    if (!podeAtuar) {
      const e = new Error('Sem permissão pra excluir documento desta etapa'); e.status = 403; throw e;
    }
  }
  await prisma.desoneracaoDocumento.delete({ where: { id: docId } });
  // Best-effort: apaga o objeto no S3 também. Falha não bloqueia.
  if (d.s3Key) storage.deleteObject(d.s3Key).catch(() => {});
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
