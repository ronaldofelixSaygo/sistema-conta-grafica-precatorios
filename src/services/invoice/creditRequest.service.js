// =====================================================================
// CRUD de Solicitação de Créditos.
// Apenas PARTNER cria. Vinculado a um Cliente do escritório dele.
// Quando RESOLVED → atualiza cliente.clienteCertificado = "Sim" se for a primeira.
// =====================================================================
import { prisma } from '../../config/prisma.js';
import { calcularInvoice } from './taxCalculator.service.js';
import * as email from '../email.service.js';
import * as storage from '../storage.service.js';

// Quem pode CRIAR solicitação: CLIENT (próprio) ou SAYGO/ADM (em nome de qualquer cliente)
function ensureRequester(user) {
  if (!user) { const e = new Error('Não autenticado'); e.status = 401; throw e; }
  if (!['CLIENT','SAYGO','ADM'].includes(user.role)) {
    const e = new Error('Apenas Cliente ou Saygo podem criar solicitações de crédito'); e.status = 403; throw e;
  }
}

// CLIENT só pode criar pra si; SAYGO/ADM pode pra qualquer cliente
async function resolveCliente(user, clienteId) {
  if (user.role === 'CLIENT') {
    if (!user.clienteId) { const e = new Error('Usuário sem cliente vinculado'); e.status = 400; throw e; }
    if (clienteId && Number(clienteId) !== user.clienteId) {
      const e = new Error('Cliente não permitido'); e.status = 403; throw e;
    }
    const cli = await prisma.cliente.findUnique({ where: { id: user.clienteId } });
    if (!cli) { const e = new Error('Cliente não encontrado'); e.status = 404; throw e; }
    return cli;
  }
  // SAYGO/ADM: precisa enviar clienteId
  if (!clienteId) { const e = new Error('clienteId é obrigatório'); e.status = 400; throw e; }
  const cli = await prisma.cliente.findUnique({ where: { id: Number(clienteId) } });
  if (!cli) { const e = new Error('Cliente não encontrado'); e.status = 404; throw e; }
  return cli;
}

// Lista filtrada por escopo do user
//  - CLIENT: só do próprio cliente
//  - PARTNER ESCRITORIO: solicitações endereçadas ao seu escritório
//  - SAYGO/ADM: tudo
export async function listRequests(user) {
  const where = {};
  if (user.role === 'CLIENT' && user.clienteId) {
    where.clienteId = user.clienteId;
  } else if (user.role === 'PARTNER') {
    const office = user.officeName || user.parceiroNome;
    if (!office) return [];
    where.partnerOfficeName = office;
  }
  // Listagem: exclui campos pesados (inputs/result Json grandes, PDF binário, anexo binário)
  return prisma.creditRequest.findMany({
    where,
    select: {
      id: true, clienteId: true, partnerOfficeName: true,
      creditosACompar: true, modalidade: true, status: true,
      message: true, inputPdfName: true,
      requestedById: true, resolvedById: true,
      createdAt: true, sentAt: true, resolvedAt: true,
      cliente:     { select: { id: true, nome: true, escritorio: true } },
      requestedBy: { select: { id: true, name: true, email: true } },
      resolvedBy:  { select: { id: true, name: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
}

// SELECT explícito EXCLUINDO inputPdfBytes e resolutionAttachmentBytes
// (PDFs inteiros, vários MB cada). Faz a query do modal abrir ~10x mais rápido.
const REQUEST_SELECT_NO_BYTES = {
  id: true, clienteId: true, partnerOfficeName: true,
  inputs: true, result: true, creditosACompar: true, modalidade: true,
  message: true, status: true,
  inputPdfName: true, // não inclui inputPdfBytes
  resolutionNote: true,
  resolutionAttachmentName: true, // não inclui resolutionAttachmentBytes
  resolutionAttachmentMime: true,
  aiPromptVersion: true,
  requestedById: true, resolvedById: true,
  createdAt: true, sentAt: true, inProgressAt: true, resolvedAt: true, updatedAt: true,
  cliente: { select: { id: true, nome: true, escritorio: true } },
  requestedBy: { select: { id: true, name: true, email: true } },
  resolvedBy:  { select: { id: true, name: true } },
};

export async function getRequest(user, id) {
  const r = await prisma.creditRequest.findUnique({
    where: { id },
    select: REQUEST_SELECT_NO_BYTES,
  });
  if (!r) { const e = new Error('Solicitação não encontrada'); e.status = 404; throw e; }
  // permissão de visualização
  const office = user.officeName || user.parceiroNome;
  const isResolver = user.role === 'PARTNER' && r.partnerOfficeName === office;
  const isClient   = user.role === 'CLIENT' && r.clienteId === user.clienteId;
  const isStaff    = user.role === 'ADM' || user.role === 'SAYGO';
  if (!isResolver && !isClient && !isStaff) {
    const e = new Error('Sem permissão'); e.status = 403; throw e;
  }
  return r;
}

// Helper interno pra downloads — carrega só o byte que precisa.
async function _loadBytes(id, field) {
  const r = await prisma.creditRequest.findUnique({
    where: { id }, select: { [field]: true, partnerOfficeName: true, clienteId: true },
  });
  return r;
}

// Apenas calcula, sem persistir
export function simulate(input) {
  return calcularInvoice(input);
}

// Cria DRAFT (cálculo + dados). Se autoSend=true, já envia (status SENT) na mesma operação.
// Solicitante: CLIENT (sempre) ou SAYGO/ADM (em nome de um cliente)
export async function createDraft(user, payload, pdfBuffer = null, pdfName = null, aiPromptVersion = null) {
  ensureRequester(user);
  const cli = await resolveCliente(user, payload.clienteId);

  const result = calcularInvoice(payload.inputs || {});
  const modalidade = payload.modalidade === 'AL_DIF' ? 'AL_DIF' : 'AL_NF';
  const creditosACompar = modalidade === 'AL_DIF' ? result.creditos.al_dif : result.creditos.al_nf;
  const autoSend = !!payload.autoSend;

  // Sobe PDF de entrada pro S3 (se configurado). Senão, bytes inline.
  let inputPdfS3Key = null;
  let inputPdfBytesData = null;
  if (pdfBuffer) {
    if (storage.isEnabled()) {
      // ID temporário pra criar a key — vamos refinar depois pelo id real
      const tmpKey = storage.buildKey('credit-requests', ['_tmp'], pdfName || 'invoice.pdf');
      await storage.uploadBuffer({
        key: tmpKey, buffer: pdfBuffer, contentType: 'application/pdf',
        contentDisposition: `inline; filename="${encodeURIComponent(pdfName || 'invoice.pdf')}"`,
      });
      inputPdfS3Key = tmpKey;
    } else {
      inputPdfBytesData = pdfBuffer;
    }
  }
  const created = await prisma.creditRequest.create({
    data: {
      clienteId: cli.id,
      partnerOfficeName: cli.escritorio || '',
      inputs: payload.inputs || {},
      result,
      creditosACompar,
      modalidade,
      message: payload.message || null,
      requestedById: user.id,
      status: autoSend ? 'SENT' : 'DRAFT',
      sentAt: autoSend ? new Date() : null,
      inputPdfName: pdfName || null,
      inputPdfBytes: inputPdfBytesData,
      inputPdfS3Key,
      aiPromptVersion: aiPromptVersion ?? null,
    },
    select: {
      id: true, clienteId: true, partnerOfficeName: true,
      creditosACompar: true, modalidade: true, status: true,
      createdAt: true, sentAt: true,
      cliente: { select: { id: true, nome: true, escritorio: true } },
    },
  });

  // Notificação em background (não bloqueia a resposta)
  if (autoSend) {
    setImmediate(() => {
      email.notifyCreditRequest({ requestId: created.id, event: 'sent', byUser: user })
        .catch(err => console.warn('[creditRequest] notify falhou:', err.message));
    });
  }

  return created;
}

// Envia: DRAFT → SENT — apenas o solicitante (ou STAFF)
export async function sendRequest(user, id) {
  const r = await getRequest(user, id);
  const isOwner = r.requestedById === user.id;
  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  if (!isOwner && !isStaff) { const e = new Error('Apenas o solicitante pode enviar'); e.status = 403; throw e; }
  if (r.status !== 'DRAFT') {
    const e = new Error('Solicitação não está em rascunho'); e.status = 400; throw e;
  }
  const updated = await prisma.creditRequest.update({
    where: { id },
    data: { status: 'SENT', sentAt: new Date() },
  });
  setImmediate(() => {
    email.notifyCreditRequest({ requestId: id, event: 'sent', byUser: user })
      .catch(err => console.warn('[creditRequest] notify falhou:', err.message));
  });
  return updated;
}

// Marca como em andamento — PARTNER ESCRITORIO do escritório alvo (resolvedor)
function ensureResolverPartner(user, r) {
  const office = user.officeName || user.parceiroNome;
  const isResolver = user.role === 'PARTNER' && r.partnerOfficeName === office;
  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  if (!isResolver && !isStaff) { const e = new Error('Sem permissão para resolver'); e.status = 403; throw e; }
}

export async function startResolution(user, id) {
  const r = await getRequest(user, id);
  ensureResolverPartner(user, r);
  if (!(r.status === 'SENT' || r.status === 'DRAFT')) {
    const e = new Error('Status inválido para iniciar'); e.status = 400; throw e;
  }
  return prisma.creditRequest.update({
    where: { id }, data: { status: 'IN_PROGRESS', inProgressAt: new Date() },
  });
}

// Conclui — opcionalmente com anexo de evidência. Atualiza certificado do cliente se for a 1ª resolução.
export async function resolveRequest(user, id, { note, attachmentName, attachmentMime, attachmentBytes } = {}) {
  const r = await getRequest(user, id);
  ensureResolverPartner(user, r);
  if (r.status === 'RESOLVED' || r.status === 'CANCELED') {
    const e = new Error('Solicitação já encerrada'); e.status = 400; throw e;
  }

  const data = {
    status: 'RESOLVED',
    resolvedAt: new Date(),
    resolvedById: user.id,
    resolutionNote: note || null,
  };
  if (attachmentBytes) {
    const safeName = attachmentName || 'evidencia';
    data.resolutionAttachmentName = safeName;
    data.resolutionAttachmentMime = attachmentMime || 'application/octet-stream';
    if (storage.isEnabled()) {
      const key = storage.buildKey('credit-requests', [id, 'resolution'], safeName);
      await storage.uploadBuffer({
        key, buffer: attachmentBytes, contentType: data.resolutionAttachmentMime,
        contentDisposition: `inline; filename="${encodeURIComponent(safeName)}"`,
      });
      data.resolutionAttachmentS3Key = key;
    } else {
      data.resolutionAttachmentBytes = attachmentBytes;
    }
  }

  const updated = await prisma.creditRequest.update({ where: { id }, data });

  // primeira solicitação concluída desse cliente? Atualiza certificado.
  const totalResolved = await prisma.creditRequest.count({
    where: { clienteId: r.clienteId, status: 'RESOLVED' },
  });
  if (totalResolved === 1) {
    await prisma.cliente.update({
      where: { id: r.clienteId }, data: { clienteCertificado: 'Sim' },
    }).catch(() => {});
  }

  setImmediate(() => {
    email.notifyCreditRequest({ requestId: id, event: 'resolved', byUser: user })
      .catch(err => console.warn('[creditRequest] notify falhou:', err.message));
  });

  return updated;
}

export async function cancelRequest(user, id) {
  const r = await getRequest(user, id);
  const isOwner = r.requestedById === user.id;
  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  if (!isOwner && !isStaff) { const e = new Error('Apenas o solicitante pode cancelar'); e.status = 403; throw e; }
  if (r.status === 'RESOLVED' || r.status === 'CANCELED') {
    const e = new Error('Solicitação já encerrada'); e.status = 400; throw e;
  }
  return prisma.creditRequest.update({ where: { id }, data: { status: 'CANCELED' } });
}

// Download do PDF original (input). S3 quando disponível, bytes inline legado.
export async function getInputPdf(user, id) {
  await getRequest(user, id); // valida permissão
  const r = await prisma.creditRequest.findUnique({
    where: { id }, select: { inputPdfBytes: true, inputPdfName: true, inputPdfS3Key: true },
  });
  if (r?.inputPdfS3Key) {
    const url = await storage.getDownloadUrl(r.inputPdfS3Key, { filename: r.inputPdfName || 'invoice.pdf', inline: true });
    return { redirectUrl: url };
  }
  if (!r?.inputPdfBytes) { const e = new Error('Sem PDF anexado'); e.status = 404; throw e; }
  return { filename: r.inputPdfName || 'invoice.pdf', bytes: r.inputPdfBytes };
}

// Download do anexo de resolução
export async function getResolutionAttachment(user, id) {
  await getRequest(user, id);
  const r = await prisma.creditRequest.findUnique({
    where: { id }, select: {
      resolutionAttachmentBytes: true, resolutionAttachmentS3Key: true,
      resolutionAttachmentName: true, resolutionAttachmentMime: true,
    },
  });
  if (r?.resolutionAttachmentS3Key) {
    const url = await storage.getDownloadUrl(r.resolutionAttachmentS3Key, {
      filename: r.resolutionAttachmentName || 'evidencia', inline: true,
    });
    return { redirectUrl: url };
  }
  if (!r?.resolutionAttachmentBytes) { const e = new Error('Sem anexo de resolução'); e.status = 404; throw e; }
  return {
    filename: r.resolutionAttachmentName || 'evidencia',
    mime: r.resolutionAttachmentMime || 'application/octet-stream',
    bytes: r.resolutionAttachmentBytes,
  };
}
