// =====================================================================
// CRUD de Solicitação de Créditos.
// Apenas PARTNER cria. Vinculado a um Cliente do escritório dele.
// Quando RESOLVED → atualiza cliente.clienteCertificado = "Sim" se for a primeira.
// =====================================================================
import { prisma } from '../../config/prisma.js';
import { calcularInvoice } from './taxCalculator.service.js';

function ensurePartner(user) {
  if (!user || user.role !== 'PARTNER') {
    const e = new Error('Apenas Intervenientes (PARTNER) podem criar solicitações'); e.status = 403; throw e;
  }
}

async function ensureClienteOfPartner(user, clienteId) {
  const officeName = user.officeName || user.parceiroNome;
  const cli = await prisma.cliente.findUnique({ where: { id: Number(clienteId) } });
  if (!cli) { const e = new Error('Cliente não encontrado'); e.status = 404; throw e; }
  if (officeName && cli.escritorio !== officeName) {
    const e = new Error('Cliente fora do seu escritório'); e.status = 403; throw e;
  }
  return cli;
}

// PARTNER lista as suas; STAFF/ADM lista todas; CLIENT só as do próprio cliente
export async function listRequests(user) {
  const where = {};
  if (user.role === 'PARTNER') {
    const office = user.officeName || user.parceiroNome;
    if (!office) return [];
    where.partnerOfficeName = office;
  } else if (user.role === 'CLIENT' && user.clienteId) {
    where.clienteId = user.clienteId;
  }
  return prisma.creditRequest.findMany({
    where,
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true } },
      requestedBy: { select: { id: true, name: true, email: true } },
      resolvedBy:  { select: { id: true, name: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function getRequest(user, id) {
  const r = await prisma.creditRequest.findUnique({
    where: { id },
    include: {
      cliente: { select: { id: true, nome: true, escritorio: true } },
      requestedBy: { select: { id: true, name: true, email: true } },
      resolvedBy:  { select: { id: true, name: true } },
    },
  });
  if (!r) { const e = new Error('Solicitação não encontrada'); e.status = 404; throw e; }
  // permissao
  const isOwner = user.role === 'PARTNER' && r.partnerOfficeName === (user.officeName || user.parceiroNome);
  const isClient = user.role === 'CLIENT' && r.clienteId === user.clienteId;
  const isStaff  = user.role === 'ADM' || user.role === 'SAYGO';
  if (!isOwner && !isClient && !isStaff) {
    const e = new Error('Sem permissão'); e.status = 403; throw e;
  }
  return r;
}

// Apenas calcula, sem persistir
export function simulate(input) {
  return calcularInvoice(input);
}

// Cria DRAFT (cálculo + dados, ainda não enviado)
export async function createDraft(user, payload, pdfBuffer = null, pdfName = null, aiPromptVersion = null) {
  ensurePartner(user);
  const cli = await ensureClienteOfPartner(user, payload.clienteId);

  const result = calcularInvoice(payload.inputs || {});
  const modalidade = payload.modalidade === 'AL_DIF' ? 'AL_DIF' : 'AL_NF';
  const creditosACompar = modalidade === 'AL_DIF' ? result.creditos.al_dif : result.creditos.al_nf;

  return prisma.creditRequest.create({
    data: {
      clienteId: cli.id,
      partnerOfficeName: cli.escritorio || (user.officeName || user.parceiroNome || ''),
      inputs: payload.inputs || {},
      result,
      creditosACompar,
      modalidade,
      message: payload.message || null,
      requestedById: user.id,
      status: 'DRAFT',
      inputPdfName: pdfName || null,
      inputPdfBytes: pdfBuffer || null,
      aiPromptVersion: aiPromptVersion ?? null,
    },
    include: { cliente: { select: { id: true, nome: true, escritorio: true } } },
  });
}

// Envia: muda status para SENT
export async function sendRequest(user, id) {
  const r = await getRequest(user, id);
  if (!(user.role === 'PARTNER' && r.partnerOfficeName === (user.officeName || user.parceiroNome))) {
    const e = new Error('Apenas o solicitante pode enviar'); e.status = 403; throw e;
  }
  if (r.status !== 'DRAFT') {
    const e = new Error('Solicitação não está em rascunho'); e.status = 400; throw e;
  }
  return prisma.creditRequest.update({
    where: { id },
    data: { status: 'SENT', sentAt: new Date() },
  });
}

// Marca como em andamento (PARTNER ESCRITORIO da Saygo / Saygo)
export async function startResolution(user, id) {
  const r = await getRequest(user, id);
  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  if (!isStaff) { const e = new Error('Sem permissão'); e.status = 403; throw e; }
  return prisma.creditRequest.update({
    where: { id }, data: { status: 'IN_PROGRESS' },
  });
}

// Conclui — atualiza cliente.clienteCertificado se for a primeira concluída
export async function resolveRequest(user, id, { note, attachments } = {}) {
  const r = await getRequest(user, id);
  const isStaff = user.role === 'ADM' || user.role === 'SAYGO';
  if (!isStaff) { const e = new Error('Sem permissão'); e.status = 403; throw e; }
  if (r.status === 'RESOLVED' || r.status === 'CANCELED') {
    const e = new Error('Solicitação já encerrada'); e.status = 400; throw e;
  }

  const updated = await prisma.creditRequest.update({
    where: { id },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolvedById: user.id,
      resolutionNote: note || null,
      ...(Array.isArray(attachments) ? { resolutionAttachments: attachments } : {}),
    },
  });

  // primeira solicitação concluída desse cliente? Atualiza certificado.
  const totalResolved = await prisma.creditRequest.count({
    where: { clienteId: r.clienteId, status: 'RESOLVED' },
  });
  if (totalResolved === 1) {
    await prisma.cliente.update({
      where: { id: r.clienteId }, data: { clienteCertificado: 'Sim' },
    }).catch(() => {});
  }

  return updated;
}

export async function cancelRequest(user, id) {
  const r = await getRequest(user, id);
  const office = user.officeName || user.parceiroNome;
  const isOwner = user.role === 'PARTNER' && r.partnerOfficeName === office;
  if (!isOwner) { const e = new Error('Apenas o solicitante pode cancelar'); e.status = 403; throw e; }
  if (r.status === 'RESOLVED' || r.status === 'CANCELED') {
    const e = new Error('Solicitação já encerrada'); e.status = 400; throw e;
  }
  return prisma.creditRequest.update({ where: { id }, data: { status: 'CANCELED' } });
}

// Download do PDF original
export async function getInputPdf(user, id) {
  const r = await getRequest(user, id);
  if (!r.inputPdfBytes) { const e = new Error('Sem PDF anexado'); e.status = 404; throw e; }
  return { filename: r.inputPdfName || 'invoice.pdf', bytes: r.inputPdfBytes };
}
