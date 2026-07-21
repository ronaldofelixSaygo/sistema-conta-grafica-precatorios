// =====================================================================
// CRUD de Solicitação de Créditos.
// Apenas PARTNER cria. Vinculado a um Cliente do escritório dele.
// Quando RESOLVED → atualiza cliente.clienteCertificado = "Sim" se for a primeira.
// =====================================================================
import { prisma } from '../../config/prisma.js';
import { calcularInvoice } from './taxCalculator.service.js';
import * as email from '../email.service.js';
import * as storage from '../storage.service.js';

// Soma os valores declarados dos comprovantes.
function sumReceipts(receipts) {
  return (receipts || []).reduce((s, x) => s + (Number(x?.valor) || 0), 0);
}

// Persiste N comprovantes (S3 quando ligado, senão bytes inline) vinculados
// à solicitação. Cada um guarda o valor declarado/confirmado.
async function persistReceipts(creditRequestId, receipts) {
  for (const rc of (receipts || [])) {
    if (!rc?.buffer) continue;
    let s3Key = null, bytes = null;
    const name = rc.name || 'comprovante';
    const mime = rc.mime || 'application/octet-stream';
    if (storage.isEnabled()) {
      const key = storage.buildKey('credit-requests', [creditRequestId, 'receipts'], name);
      await storage.uploadBuffer({
        key, buffer: rc.buffer, contentType: mime,
        contentDisposition: `inline; filename="${encodeURIComponent(name)}"`,
      });
      s3Key = key;
    } else {
      bytes = rc.buffer;
    }
    let data = null;
    if (rc.data) { const d = new Date(String(rc.data).slice(0, 10) + 'T00:00:00.000Z'); if (!isNaN(d.getTime())) data = d; }
    await prisma.creditRequestReceipt.create({
      data: { creditRequestId, filename: name, mimeType: mime, bytes, s3Key, valor: Number(rc.valor) || 0, data },
    });
  }
}

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
      paymentReceiptName: true,
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
  paymentReceiptName: true, // não inclui paymentReceiptBytes
  paymentReceiptMime: true,
  paymentReceiptUploadedAt: true,
  resolutionNote: true,
  resolutionAttachmentName: true, // não inclui resolutionAttachmentBytes
  resolutionAttachmentMime: true,
  aiPromptVersion: true,
  requestedById: true, resolvedById: true,
  createdAt: true, sentAt: true, inProgressAt: true, resolvedAt: true, updatedAt: true,
  cliente: { select: { id: true, nome: true, escritorio: true } },
  requestedBy: { select: { id: true, name: true, email: true } },
  resolvedBy:  { select: { id: true, name: true } },
  receipts: {
    select: { id: true, filename: true, mimeType: true, valor: true, data: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
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

// Download de um comprovante específico (novo modelo, N por solicitação).
export async function getReceiptItem(user, id, receiptId, opts = {}) {
  await getRequest(user, id); // valida permissão de acesso à solicitação
  const rc = await prisma.creditRequestReceipt.findFirst({
    where: { id: receiptId, creditRequestId: id },
  });
  if (!rc) { const e = new Error('Comprovante não encontrado'); e.status = 404; throw e; }
  const inline = !opts.download;
  if (rc.s3Key) {
    const url = await storage.getDownloadUrl(rc.s3Key, { filename: rc.filename, inline });
    return { redirectUrl: url };
  }
  if (!rc.bytes) { const e = new Error('Arquivo indisponível'); e.status = 404; throw e; }
  return { bytes: rc.bytes, filename: rc.filename, mime: rc.mimeType || 'application/octet-stream', _inline: inline };
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
export async function createDraft(user, payload, pdfBuffer = null, pdfName = null, aiPromptVersion = null, receipts = []) {
  ensureRequester(user);
  const cli = await resolveCliente(user, payload.clienteId);

  const modalidade = payload.modalidade === 'AL_DIF' ? 'AL_DIF' : 'AL_NF';
  const autoSend = !!payload.autoSend;

  // Dois modos de criação:
  //  (a) Invoice (NCM): calcula o crédito a partir dos inputs; sugestão = +10%.
  //  (b) Manual: o cliente informa o valor de crédito desejado; o depósito é
  //      percentualDeposito% do cliente sobre esse valor.
  const isManual = !!payload.manual && Number(payload.creditosManuais) > 0;
  let result, creditosACompar;
  if (isManual) {
    const pct = Number(cli.percentualDeposito ?? 30);
    creditosACompar = Math.round(Number(payload.creditosManuais));
    const depositoNecessario = Math.round(creditosACompar * pct / 100);
    const valorDepositado = (payload.valorDepositado != null && payload.valorDepositado !== '')
      ? Math.round(Number(payload.valorDepositado)) : null;
    result = { manual: true, creditos: creditosACompar, percentualDeposito: pct,
               depositoNecessario, valorDepositado };
    payload.inputs = { manual: true, creditosManuais: creditosACompar, percentualDeposito: pct };
  } else {
    // REGRA: o crédito a comprar SEMPRE é o ICMS reduzido de Alagoas (4% via NF).
    // O cenário 1,2% (diferimento) é só informativo — a sugestão acrescenta +10%.
    result = calcularInvoice(payload.inputs || {});
    creditosACompar = result.creditos.al_nf;
  }

  // Comprovantes de depósito (0..N). Para enviar (autoSend) exige ≥1.
  const rcList = (receipts || []).filter(rc => rc && rc.buffer);
  const hasReceipts = rcList.length > 0;
  const depositoTotal = sumReceipts(rcList);
  if (autoSend && !hasReceipts) {
    const e = new Error('Anexe pelo menos um comprovante de depósito para enviar ao interveniente');
    e.status = 400; throw e;
  }
  // Manual: a soma dos comprovantes precisa cobrir o depósito exigido.
  if (autoSend && isManual && depositoTotal < result.depositoNecessario) {
    const e = new Error(`A soma dos comprovantes (R$ ${depositoTotal}) deve ser igual ou maior que o depósito necessário (R$ ${result.depositoNecessario}).`);
    e.status = 400; throw e;
  }
  if (isManual && hasReceipts) result.valorDepositado = depositoTotal;
  // Marcador legado (compat com telas/listagens antigas).
  const receiptName = hasReceipts
    ? (rcList.length === 1 ? (rcList[0].name || 'comprovante') : `${rcList.length} comprovante(s)`)
    : null;

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
      paymentReceiptName: receiptName,
      paymentReceiptUploadedAt: hasReceipts ? new Date() : null,
      aiPromptVersion: aiPromptVersion ?? null,
    },
    select: {
      id: true, clienteId: true, partnerOfficeName: true,
      creditosACompar: true, modalidade: true, status: true,
      createdAt: true, sentAt: true,
      cliente: { select: { id: true, nome: true, escritorio: true } },
    },
  });

  // Grava os comprovantes (precisa do id real).
  if (hasReceipts) await persistReceipts(created.id, rcList);

  // Notificação em background (não bloqueia a resposta)
  if (autoSend) {
    setImmediate(() => {
      email.notifyCreditRequest({ requestId: created.id, event: 'sent', byUser: user })
        .catch(err => console.warn('[creditRequest] notify falhou:', err.message));
    });
  }

  return created;
}

// Edita um rascunho: valor de crédito (manual), mensagem, e comprovantes
// (adiciona novos, atualiza valor/data dos mantidos, apaga os removidos).
export async function updateDraft(user, id, payload = {}, receipts = []) {
  const r = await getRequest(user, id);
  const isOwner = r.requestedById === user.id;
  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  if (!isOwner && !isStaff) { const e = new Error('Sem permissão'); e.status = 403; throw e; }
  if (r.status !== 'DRAFT') { const e = new Error('Apenas rascunhos podem ser editados'); e.status = 400; throw e; }

  const data = {};
  if (payload.message !== undefined) data.message = payload.message || null;

  // Manual: recalcula crédito e depósito necessário
  const isManual = !!(r.result && r.result.manual);
  if (isManual && payload.creditosManuais != null && Number(payload.creditosManuais) > 0) {
    const cli = await prisma.cliente.findUnique({ where: { id: r.clienteId } });
    const pct = Number(cli?.percentualDeposito ?? r.result.percentualDeposito ?? 30);
    const creditos = Math.round(Number(payload.creditosManuais));
    data.creditosACompar = creditos;
    data.result = { ...r.result, creditos, percentualDeposito: pct, depositoNecessario: Math.round(creditos * pct / 100) };
  }

  // Reconcilia comprovantes existentes: mantém/atualiza os informados, apaga o resto
  const kept = Array.isArray(payload.existing) ? payload.existing : [];
  const keptMap = new Map(kept.map(k => [k.id, k]));
  const current = await prisma.creditRequestReceipt.findMany({ where: { creditRequestId: id } });
  for (const rc of current) {
    if (!keptMap.has(rc.id)) {
      if (rc.s3Key) storage.deleteObject(rc.s3Key).catch(() => {});
      await prisma.creditRequestReceipt.delete({ where: { id: rc.id } });
    } else {
      const k = keptMap.get(rc.id);
      const upd = { valor: Number(k.valor) || 0 };
      if (k.data !== undefined) {
        const d = k.data ? new Date(String(k.data).slice(0, 10) + 'T00:00:00.000Z') : null;
        upd.data = (d && !isNaN(d.getTime())) ? d : null;
      }
      await prisma.creditRequestReceipt.update({ where: { id: rc.id }, data: upd }).catch(() => {});
    }
  }
  // Adiciona novos comprovantes
  const rcList = (receipts || []).filter(x => x && x.buffer);
  if (rcList.length) await persistReceipts(id, rcList);

  // Recalcula total depositado + marcador legado
  const agg = await prisma.creditRequestReceipt.aggregate({
    where: { creditRequestId: id }, _count: true, _sum: { valor: true },
  });
  const total = agg._count || 0;
  data.paymentReceiptName = total > 0 ? (total === 1 ? 'comprovante' : `${total} comprovante(s)`) : null;
  data.paymentReceiptUploadedAt = total > 0 ? new Date() : null;
  if (isManual) {
    const base = data.result || r.result || {};
    data.result = { ...base, valorDepositado: agg._sum.valor || 0 };
  }

  await prisma.creditRequest.update({ where: { id }, data });
  return getRequest(user, id);
}

// Envia: DRAFT → SENT — apenas o solicitante (ou STAFF)
export async function sendRequest(user, id, receipts = []) {
  const r = await getRequest(user, id);
  const isOwner = r.requestedById === user.id;
  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  if (!isOwner && !isStaff) { const e = new Error('Apenas o solicitante pode enviar'); e.status = 403; throw e; }
  if (r.status !== 'DRAFT') {
    const e = new Error('Solicitação não está em rascunho'); e.status = 400; throw e;
  }

  const data = { status: 'SENT', sentAt: new Date() };

  // REGRA DE NEGÓCIO: não avança ao interveniente sem comprovante de depósito.
  const rcList = (receipts || []).filter(rc => rc && rc.buffer);
  const existing = Array.isArray(r.receipts) ? r.receipts : [];
  const hasAny = rcList.length > 0 || existing.length > 0 || !!r.paymentReceiptName;
  if (!hasAny) {
    const e = new Error('Anexe pelo menos um comprovante de depósito para enviar ao interveniente');
    e.status = 400; throw e;
  }
  // Manual: a soma (existentes + novos) precisa cobrir o depósito exigido.
  const isManual = !!(r.result && r.result.manual);
  if (isManual) {
    const necessario = Number(r.result.depositoNecessario || 0);
    const totalExistente = existing.reduce((s, x) => s + (Number(x.valor) || 0), 0);
    const total = totalExistente + sumReceipts(rcList);
    if (total < necessario) {
      const e = new Error(`A soma dos comprovantes (R$ ${total}) deve ser igual ou maior que o depósito necessário (R$ ${necessario}).`);
      e.status = 400; throw e;
    }
  }
  if (rcList.length) {
    await persistReceipts(id, rcList);
    const count = existing.length + rcList.length;
    data.paymentReceiptName = count === 1 ? (rcList[0].name || 'comprovante') : `${count} comprovante(s)`;
    data.paymentReceiptUploadedAt = new Date();
  }
  // Mantém o total depositado coerente com a soma real dos comprovantes.
  if (isManual) {
    const agg = await prisma.creditRequestReceipt.aggregate({ where: { creditRequestId: id }, _sum: { valor: true } });
    data.result = { ...r.result, valorDepositado: agg._sum.valor || 0 };
  }

  const updated = await prisma.creditRequest.update({
    where: { id },
    data,
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
  const updated = await prisma.creditRequest.update({
    where: { id }, data: { status: 'IN_PROGRESS', inProgressAt: new Date() },
  });
  // Notifica o cliente que o parceiro aceitou a solicitação
  setImmediate(() => {
    email.notifyCreditRequest({ requestId: id, event: 'in_progress', byUser: user })
      .catch(err => console.warn('[creditRequest] notify in_progress falhou:', err.message));
  });
  return updated;
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
export async function getInputPdf(user, id, opts = {}) {
  await getRequest(user, id); // valida permissão
  const r = await prisma.creditRequest.findUnique({
    where: { id }, select: { inputPdfBytes: true, inputPdfName: true, inputPdfS3Key: true },
  });
  const inline = !opts.download;
  if (r?.inputPdfS3Key) {
    const url = await storage.getDownloadUrl(r.inputPdfS3Key, { filename: r.inputPdfName || 'invoice.pdf', inline });
    return { redirectUrl: url };
  }
  if (!r?.inputPdfBytes) { const e = new Error('Sem PDF anexado'); e.status = 404; throw e; }
  return { filename: r.inputPdfName || 'invoice.pdf', bytes: r.inputPdfBytes, _inline: inline };
}

// Download do comprovante de depósito. S3 quando disponível, bytes inline legado.
export async function getPaymentReceipt(user, id, opts = {}) {
  await getRequest(user, id); // valida permissão
  const r = await prisma.creditRequest.findUnique({
    where: { id }, select: {
      paymentReceiptBytes: true, paymentReceiptS3Key: true,
      paymentReceiptName: true, paymentReceiptMime: true,
    },
  });
  const inline = !opts.download;
  if (r?.paymentReceiptS3Key) {
    const url = await storage.getDownloadUrl(r.paymentReceiptS3Key, {
      filename: r.paymentReceiptName || 'comprovante', inline,
    });
    return { redirectUrl: url };
  }
  if (!r?.paymentReceiptBytes) { const e = new Error('Sem comprovante anexado'); e.status = 404; throw e; }
  return {
    filename: r.paymentReceiptName || 'comprovante',
    mime: r.paymentReceiptMime || 'application/octet-stream',
    bytes: r.paymentReceiptBytes,
    _inline: inline,
  };
}

// Download do anexo de resolução
export async function getResolutionAttachment(user, id, opts = {}) {
  await getRequest(user, id);
  const r = await prisma.creditRequest.findUnique({
    where: { id }, select: {
      resolutionAttachmentBytes: true, resolutionAttachmentS3Key: true,
      resolutionAttachmentName: true, resolutionAttachmentMime: true,
    },
  });
  const inline = !opts.download;
  if (r?.resolutionAttachmentS3Key) {
    const url = await storage.getDownloadUrl(r.resolutionAttachmentS3Key, {
      filename: r.resolutionAttachmentName || 'evidencia', inline,
    });
    return { redirectUrl: url };
  }
  if (!r?.resolutionAttachmentBytes) { const e = new Error('Sem anexo de resolução'); e.status = 404; throw e; }
  return {
    filename: r.resolutionAttachmentName || 'evidencia',
    mime: r.resolutionAttachmentMime || 'application/octet-stream',
    bytes: r.resolutionAttachmentBytes,
    _inline: inline,
  };
}
