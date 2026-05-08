// =====================================================================
// Envio de e-mail. Lê config do banco (EmailSettings singleton 'default').
// Inclui templates simples para Kanban e Acionamentos.
// Inspirado no padrão usado no projeto Indicadores_Comercial_Bitrix
// (config configurável + triggers em eventos de negócio).
// =====================================================================
import nodemailer from 'nodemailer';
import { prisma } from '../config/prisma.js';

let transporterCache = null;
let cacheKey = null;

async function getSettings() {
  let s = await prisma.emailSettings.findUnique({ where: { id: 'default' } });
  if (!s) {
    s = await prisma.emailSettings.create({ data: { id: 'default' } });
  }
  return s;
}

async function getTransporter() {
  const s = await getSettings();
  if (!s.enabled || !s.host || !s.user) return null;
  const key = `${s.host}|${s.port}|${s.secure}|${s.user}`;
  if (transporterCache && cacheKey === key) return transporterCache;
  transporterCache = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: !!s.secure,
    auth: { user: s.user, pass: s.pass || '' },
  });
  cacheKey = key;
  return transporterCache;
}

export async function getSettingsSafe() {
  const s = await getSettings();
  // Não vaza a senha
  return { ...s, pass: s.pass ? '***' : '' };
}

export async function updateSettings(data) {
  const s = await getSettings();
  const upd = {};
  for (const k of ['enabled','host','port','secure','user','fromAddress','fromName',
                   'notifyKanbanStageChange','notifyKanbanStageDone','notifyPartnerRequest']) {
    if (data[k] !== undefined) upd[k] = (k === 'port') ? (Number(data[k]) || 587)
                                       : (typeof data[k] === 'boolean' ? data[k] : data[k] || null);
  }
  // Senha só se enviada e diferente do mascarado
  if (data.pass !== undefined && data.pass !== '***') upd.pass = data.pass || null;
  // limpa cache
  transporterCache = null; cacheKey = null;
  return prisma.emailSettings.update({ where: { id: 'default' }, data: upd });
}

async function logEmail({ to, subject, status, error, context, contextId }) {
  try {
    await prisma.emailLog.create({ data: { to, subject, status, error: error || null, context: context || null, contextId: contextId || null } });
  } catch {}
}

// Envia e-mail (não bloqueia caller; loga em background)
export async function sendMail({ to, subject, html, text, context, contextId }) {
  if (!to) return;
  try {
    const t = await getTransporter();
    if (!t) {
      await logEmail({ to, subject, status: 'error', error: 'SMTP nao configurado/ativo', context, contextId });
      return;
    }
    const s = await getSettings();
    const from = s.fromName ? `"${s.fromName}" <${s.fromAddress || s.user}>` : (s.fromAddress || s.user);
    await t.sendMail({ from, to, subject, html, text: text || stripHtml(html||'') });
    await logEmail({ to, subject, status: 'sent', context, contextId });
  } catch (e) {
    console.error('[email] erro:', e.message);
    await logEmail({ to, subject, status: 'error', error: e.message, context, contextId });
  }
}

function stripHtml(s) { return String(s||'').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function escape(s) { return String(s||'').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c])); }

function baseTemplate(title, bodyHtml) {
  return `
  <div style="font-family:-apple-system,'Segoe UI',sans-serif;background:#f4f5f8;padding:20px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
      <div style="background:#1E2A3A;color:#fff;padding:14px 20px;display:flex;align-items:center;gap:10px">
        <div style="background:#F58220;width:30px;height:30px;border-radius:7px;color:#fff;font-weight:700;display:inline-flex;align-items:center;justify-content:center">S</div>
        <strong style="font-size:15px">Sistema Conta Gráfica</strong>
      </div>
      <div style="padding:24px;color:#1a1a1a">
        <h2 style="margin:0 0 16px;color:#1E2A3A;font-size:18px">${escape(title)}</h2>
        ${bodyHtml}
      </div>
      <div style="background:#f0f1f4;padding:12px 20px;color:#777;font-size:11px;text-align:center">
        Este é um e-mail automático do Sistema Conta Gráfica — Saygo Group.
      </div>
    </div>
  </div>`;
}

// === Templates ===

export function templateKanbanStageChange({ clienteName, fromStage, toStage, byUserName }) {
  return {
    subject: `[Kanban] ${clienteName}: ${toStage}`,
    html: baseTemplate(`Movimentação no Kanban — ${clienteName}`, `
      <p>O card de habilitação avançou de etapa.</p>
      <p style="background:#f4f5f8;padding:12px;border-radius:6px">
        <strong>De:</strong> ${escape(fromStage || '—')}<br>
        <strong>Para:</strong> ${escape(toStage)}<br>
        <strong>Por:</strong> ${escape(byUserName || '—')}
      </p>
      <p>Acesse o sistema para ver os detalhes.</p>
    `),
  };
}

export function templateKanbanStageDone({ clienteName, stage, byUserName }) {
  return {
    subject: `[Kanban] Etapa concluída: ${stage} — ${clienteName}`,
    html: baseTemplate(`Etapa concluída — ${clienteName}`, `
      <p>A etapa <strong>${escape(stage)}</strong> do cliente <strong>${escape(clienteName)}</strong> foi concluída.</p>
      <p><strong>Por:</strong> ${escape(byUserName || '—')}</p>
    `),
  };
}

export function templatePartnerRequest({ clienteName, type, message, byUserName }) {
  return {
    subject: `[Acionamento] ${clienteName} solicitou ${type}`,
    html: baseTemplate(`Nova solicitação: ${clienteName}`, `
      <p>Você recebeu uma solicitação no sistema:</p>
      <p style="background:#f4f5f8;padding:12px;border-radius:6px">
        <strong>Cliente:</strong> ${escape(clienteName)}<br>
        <strong>Tipo:</strong> ${escape(type)}<br>
        <strong>Solicitante:</strong> ${escape(byUserName || '—')}
      </p>
      ${message ? `<p><strong>Mensagem:</strong></p><blockquote style="border-left:3px solid #F58220;padding-left:12px;color:#444">${escape(message)}</blockquote>` : ''}
      <p>Acesse o sistema para responder.</p>
    `),
  };
}

// === Helpers de notificação por evento ===

// Resolve destinatários para um cliente: cliente vinculado + parceiros do escritório + Saygo
async function recipientsForCliente(clienteId) {
  const cli = await prisma.cliente.findUnique({
    where: { id: clienteId },
    include: { user: { select: { email: true } } },
  });
  if (!cli) return [];
  const emails = new Set();
  if (cli.user?.email) emails.add(cli.user.email);
  if (cli.escritorio) {
    const partners = await prisma.user.findMany({
      where: { role: 'PARTNER', officeName: cli.escritorio, active: true, email: { not: null } },
      select: { email: true },
    });
    for (const p of partners) emails.add(p.email);
  }
  // Saygo gerais
  const saygo = await prisma.user.findMany({
    where: { role: { in: ['SAYGO','ADM'] }, active: true, email: { not: null } },
    select: { email: true },
  });
  for (const s of saygo) emails.add(s.email);
  return [...emails];
}

export async function notifyStageChange({ cardId, fromStage, toStage, byUser }) {
  const s = await getSettings();
  if (!s.enabled || !s.notifyKanbanStageChange) return;
  const card = await prisma.kanbanCard.findUnique({
    where: { id: cardId },
    include: { cliente: true },
  });
  if (!card) return;
  const tos = await recipientsForCliente(card.clienteId);
  if (!tos.length) return;
  const stages = await prisma.kanbanStageDef.findMany();
  const stgFrom = stages.find(s => s.key === fromStage)?.label || fromStage;
  const stgTo   = stages.find(s => s.key === toStage)?.label   || toStage;
  const tpl = templateKanbanStageChange({ clienteName: card.cliente.nome, fromStage: stgFrom, toStage: stgTo, byUserName: byUser?.name });
  for (const to of tos) {
    sendMail({ ...tpl, to, context: 'kanban_stage_change', contextId: cardId });
  }
}

export async function notifyStageDone({ cardId, stageKey, byUser }) {
  const s = await getSettings();
  if (!s.enabled || !s.notifyKanbanStageDone) return;
  const card = await prisma.kanbanCard.findUnique({
    where: { id: cardId },
    include: { cliente: true },
  });
  if (!card) return;
  const tos = await recipientsForCliente(card.clienteId);
  if (!tos.length) return;
  const stg = await prisma.kanbanStageDef.findFirst({ where: { key: stageKey } });
  const tpl = templateKanbanStageDone({ clienteName: card.cliente.nome, stage: stg?.label || stageKey, byUserName: byUser?.name });
  for (const to of tos) {
    sendMail({ ...tpl, to, context: 'kanban_stage_done', contextId: cardId });
  }
}

export async function notifyPartnerRequest({ requestId, byUser }) {
  const s = await getSettings();
  if (!s.enabled || !s.notifyPartnerRequest) return;
  const req = await prisma.partnerRequest.findUnique({
    where: { id: requestId },
    include: { cliente: true },
  });
  if (!req) return;
  // Destinatários: parceiros do escritório-alvo + Saygo
  const partners = await prisma.user.findMany({
    where: { role: 'PARTNER', officeName: req.partnerOfficeName, active: true, email: { not: null } },
    select: { email: true },
  });
  const saygo = await prisma.user.findMany({
    where: { role: { in: ['SAYGO','ADM'] }, active: true, email: { not: null } },
    select: { email: true },
  });
  const tos = [...new Set([...partners.map(p=>p.email), ...saygo.map(s=>s.email)])];
  if (!tos.length) return;
  const tpl = templatePartnerRequest({
    clienteName: req.cliente.nome, type: req.type, message: req.message, byUserName: byUser?.name,
  });
  for (const to of tos) {
    sendMail({ ...tpl, to, context: 'partner_request', contextId: requestId });
  }
}

export async function sendTestMail(to) {
  const tpl = {
    subject: '[TESTE] Sistema Conta Gráfica',
    html: baseTemplate('E-mail de teste', `
      <p>Este é um e-mail de teste do seu SMTP.</p>
      <p>Se você recebeu isso, está tudo configurado certinho!</p>
      <p>Data/hora: ${new Date().toLocaleString('pt-BR')}</p>
    `),
  };
  await sendMail({ ...tpl, to, context: 'test' });
}
