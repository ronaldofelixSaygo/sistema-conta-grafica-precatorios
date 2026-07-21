import * as svc from '../services/invoice/creditRequest.service.js';
import * as ai  from '../services/invoice/invoiceAi.service.js';
import { logAction } from '../services/audit.service.js';
import { prisma } from '../config/prisma.js';

// === SLA Config ===
// 2 fases configuráveis. Defaults: 24h pra começar a tratar, 72h pra concluir.
// listadas sempre — se não existem no banco, retorna defaults.
const SLA_FASES = [
  { fase: 'SENT_TO_PROGRESS',       slaHours: 24, label: 'Aceitar a solicitação (de Enviada para Em andamento)' },
  { fase: 'IN_PROGRESS_TO_RESOLVED', slaHours: 72, label: 'Concluir a solicitação (de Em andamento para Concluída)' },
];

export async function getSlaConfig(_req, res, next) {
  try {
    const rows = await prisma.creditSlaConfig.findMany();
    const byFase = new Map(rows.map(r => [r.fase, r]));
    const merged = SLA_FASES.map(d => byFase.get(d.fase) || d);
    res.json(merged);
  } catch (e) { next(e); }
}

export async function saveSlaConfig(req, res, next) {
  try {
    const items = Array.isArray(req.body) ? req.body : [];
    for (const it of items) {
      if (!it?.fase) continue;
      const slaHours = Math.max(0, Number(it.slaHours) || 0);
      await prisma.creditSlaConfig.upsert({
        where: { fase: it.fase },
        create: { fase: it.fase, slaHours, label: it.label || null },
        update: { slaHours, label: it.label || null },
      });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// === IA Settings (somente ADM via routes) ===
export async function getSettings(_req, res, next) {
  try {
    const s = await ai.getAiSettings();
    // não devolve a apiKey real (só flag de presença)
    res.json({
      provider: s?.provider || 'anthropic',
      model: s?.model || '',
      systemPrompt: s?.systemPrompt || '',
      enabled: !!s?.enabled,
      hasApiKey: !!(s?.apiKey),
      updatedAt: s?.updatedAt || null,
    });
  } catch (e) { next(e); }
}
export async function saveSettings(req, res, next) {
  try {
    const body = req.body || {};
    // apiKey vazio = manter o existente
    let apiKey = body.apiKey;
    if (apiKey === '' || apiKey == null) {
      const cur = await ai.getAiSettings();
      apiKey = cur?.apiKey || null;
    }
    const s = await ai.saveAiSettings({ ...body, apiKey });
    await logAction({ user: req.user, action: 'UPDATE', entity: 'ai_settings', ip: req.ip });
    res.json({ ok: true, provider: s.provider, model: s.model, enabled: s.enabled });
  } catch (e) { next(e); }
}

// === Prompt versions (somente ADM) ===
export async function listPromptVersions(_req, res, next) {
  try { res.json(await ai.listPromptVersions()); } catch (e) { next(e); }
}
export async function getActivePrompt(_req, res, next) {
  try {
    res.json({
      content: await ai.getActivePromptText(),
      version: await ai.getActivePromptVersionNumber(),
    });
  } catch (e) { next(e); }
}
export async function newPromptVersion(req, res, next) {
  try {
    const v = await ai.createPromptVersion(req.user, req.body || {});
    await logAction({ user: req.user, action: 'CREATE', entity: 'ai_prompt_version', entityId: v.id, ip: req.ip });
    res.status(201).json(v);
  } catch (e) { next(e); }
}
export async function activatePrompt(req, res, next) {
  try {
    const v = await ai.activatePromptVersion(req.params.id);
    await logAction({ user: req.user, action: 'UPDATE', entity: 'ai_prompt_version', entityId: v.id, details: 'activate', ip: req.ip });
    res.json(v);
  } catch (e) { next(e); }
}

// === Análise de PDF ===
export async function analyzePdf(req, res, next) {
  try {
    if (!req.file) { const e = new Error('Arquivo não enviado'); e.status = 400; throw e; }
    const buf = req.file.buffer;
    const out = await ai.analyzeInvoicePdf(buf);
    res.json(out);
  } catch (e) { next(e); }
}

// === Leitura do valor de um comprovante via IA (best-effort) ===
export async function analyzeReceipt(req, res, next) {
  try {
    if (!req.file) { const e = new Error('Arquivo não enviado'); e.status = 400; throw e; }
    const out = await ai.analyzeReceiptValue(req.file.buffer, req.file.mimetype);
    res.json(out);
  } catch (e) { next(e); }
}

// Normaliza os comprovantes recebidos no multipart em [{buffer,name,mime,valor}].
// Aceita 'comprovantes' (N arquivos) + 'valores' (JSON array alinhado) e, por
// retrocompat, o campo único 'comprovante'.
function collectReceipts(req) {
  const body = req.body || {};
  let valores = [], datas = [];
  try { valores = body.valores ? JSON.parse(body.valores) : []; } catch { valores = []; }
  try { datas = body.datas ? JSON.parse(body.datas) : []; } catch { datas = []; }
  const files = req.files?.comprovantes || [];
  const out = files.map((f, i) => ({
    buffer: f.buffer, name: f.originalname, mime: f.mimetype,
    valor: Number(valores[i]) || 0, data: datas[i] || null,
  }));
  const single = req.files?.comprovante?.[0] || (req.file && req.file.fieldname === 'comprovante' ? req.file : null);
  if (single) out.push({ buffer: single.buffer, name: single.originalname, mime: single.mimetype, valor: Number(body.valorDepositado) || 0, data: body.dataDeposito || null });
  return out;
}

// === Simulação on-the-fly (sem persistir) ===
export async function simulate(req, res, next) {
  try {
    const r = svc.simulate(req.body?.inputs || req.body || {});
    res.json(r);
  } catch (e) { next(e); }
}

// === CRUD Credit Requests ===
export async function list(req, res, next) {
  try { res.json(await svc.listRequests(req.user)); } catch (e) { next(e); }
}
export async function get(req, res, next) {
  try { res.json(await svc.getRequest(req.user, req.params.id)); } catch (e) { next(e); }
}
export async function create(req, res, next) {
  try {
    // suporta multipart com pdf opcional
    const body = req.body || {};
    const inputs = typeof body.inputs === 'string' ? JSON.parse(body.inputs) : (body.inputs || {});
    const payload = {
      clienteId: body.clienteId,
      modalidade: body.modalidade,
      message: body.message,
      inputs,
      autoSend: body.autoSend === 'true' || body.autoSend === true,
      // Modo manual: cliente informa o valor de crédito desejado; depósito = %
      // do cliente. valorDepositado = valor declarado no comprovante.
      manual: body.manual === 'true' || body.manual === true,
      creditosManuais: (body.creditosManuais != null && body.creditosManuais !== '') ? Number(body.creditosManuais) : null,
      valorDepositado: (body.valorDepositado != null && body.valorDepositado !== '') ? Number(body.valorDepositado) : null,
    };
    // create aceita multipart: 'file' (PDF da invoice) + N comprovantes.
    const pdfFile = req.files?.file?.[0] || null;
    const pdfBuffer = pdfFile?.buffer || null;
    const pdfName   = pdfFile?.originalname || null;
    const receipts = collectReceipts(req);
    const promptVersion = body.aiPromptVersion ? Number(body.aiPromptVersion) : null;
    const r = await svc.createDraft(req.user, payload, pdfBuffer, pdfName, promptVersion, receipts);
    await logAction({ user: req.user, action: 'CREATE', entity: 'credit_request', entityId: r.id, ip: req.ip });
    res.status(201).json(r);
  } catch (e) { next(e); }
}
export async function send(req, res, next) {
  try {
    const receipts = collectReceipts(req);
    const r = await svc.sendRequest(req.user, req.params.id, receipts);
    await logAction({ user: req.user, action: 'SEND', entity: 'credit_request', entityId: r.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
export async function start(req, res, next) {
  try {
    const r = await svc.startResolution(req.user, req.params.id);
    await logAction({ user: req.user, action: 'IN_PROGRESS', entity: 'credit_request', entityId: r.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
export async function resolve(req, res, next) {
  try {
    const body = req.body || {};
    const args = { note: body.note };
    if (req.file) {
      args.attachmentName  = req.file.originalname;
      args.attachmentMime  = req.file.mimetype;
      args.attachmentBytes = req.file.buffer;
    }
    const r = await svc.resolveRequest(req.user, req.params.id, args);
    await logAction({ user: req.user, action: 'RESOLVE', entity: 'credit_request', entityId: r.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
export async function downloadEvidence(req, res, next) {
  try {
    const download = req.query.download === '1' || req.query.download === 'true';
    const r = await svc.getResolutionAttachment(req.user, req.params.id, { download });
    // S3: redirect 302 pra URL assinada (zero peso no servidor)
    if (r.redirectUrl) return res.redirect(r.redirectUrl);
    // Legado: bytes
    const disposition = r._inline === false ? 'attachment' : 'inline';
    res.setHeader('Content-Type', r.mime);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(r.filename)}"`);
    res.end(Buffer.from(r.bytes));
  } catch (e) { next(e); }
}
export async function downloadPaymentReceipt(req, res, next) {
  try {
    const download = req.query.download === '1' || req.query.download === 'true';
    const r = await svc.getPaymentReceipt(req.user, req.params.id, { download });
    if (r.redirectUrl) return res.redirect(r.redirectUrl);
    const disposition = r._inline === false ? 'attachment' : 'inline';
    res.setHeader('Content-Type', r.mime);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(r.filename)}"`);
    res.end(Buffer.from(r.bytes));
  } catch (e) { next(e); }
}
export async function downloadReceiptItem(req, res, next) {
  try {
    const download = req.query.download === '1' || req.query.download === 'true';
    const r = await svc.getReceiptItem(req.user, req.params.id, req.params.rid, { download });
    if (r.redirectUrl) return res.redirect(r.redirectUrl);
    const disposition = r._inline === false ? 'attachment' : 'inline';
    res.setHeader('Content-Type', r.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(r.filename)}"`);
    res.end(Buffer.from(r.bytes));
  } catch (e) { next(e); }
}
export async function cancel(req, res, next) {
  try {
    const r = await svc.cancelRequest(req.user, req.params.id);
    await logAction({ user: req.user, action: 'CANCEL', entity: 'credit_request', entityId: r.id, ip: req.ip });
    res.json(r);
  } catch (e) { next(e); }
}
export async function downloadPdf(req, res, next) {
  try {
    const download = req.query.download === '1' || req.query.download === 'true';
    const r = await svc.getInputPdf(req.user, req.params.id, { download });
    // S3: redirect 302 pra URL assinada
    if (r.redirectUrl) return res.redirect(r.redirectUrl);
    // Legado: bytes
    const disposition = r._inline === false ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(r.filename)}"`);
    res.end(Buffer.from(r.bytes));
  } catch (e) { next(e); }
}
