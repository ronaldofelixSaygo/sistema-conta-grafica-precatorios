// =====================================================================
// Envio de e-mail via API interna Saygo (mesmo padrão do projeto
// Indicadores_Comercial_Bitrix). POST com x-access-token.
// =====================================================================
import { prisma } from '../config/prisma.js';

async function getSettings() {
  let s = await prisma.emailSettings.findUnique({ where: { id: 'default' } });
  if (!s) {
    s = await prisma.emailSettings.create({ data: { id: 'default' } });
  }
  return s;
}

export async function getSettingsSafe() {
  const s = await getSettings();
  // Não vaza tokens/senhas — só retorna flag de presença
  return {
    ...s,
    apiToken: s.apiToken ? '***' : '',
    pass: s.pass ? '***' : '',
  };
}

export async function updateSettings(data) {
  const upd = {};
  // Novos campos (padrão API Saygo)
  if (data.enabled  !== undefined) upd.enabled  = !!data.enabled;
  if (data.apiUrl   !== undefined) upd.apiUrl   = data.apiUrl   || null;
  if (data.sender   !== undefined) upd.sender   = data.sender   || null;
  // Token: vazio ou '***' = manter o atual
  if (data.apiToken !== undefined && data.apiToken !== '' && data.apiToken !== '***') {
    upd.apiToken = data.apiToken;
  }
  // Triggers
  if (data.notifyKanbanStageChange !== undefined) upd.notifyKanbanStageChange = !!data.notifyKanbanStageChange;
  if (data.notifyKanbanStageDone   !== undefined) upd.notifyKanbanStageDone   = !!data.notifyKanbanStageDone;
  if (data.notifyPartnerRequest    !== undefined) upd.notifyPartnerRequest    = !!data.notifyPartnerRequest;

  return prisma.emailSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...upd },
    update: upd,
  });
}

async function logEmail({ to, subject, status, error, context, contextId }) {
  try {
    await prisma.emailLog.create({ data: { to, subject, status, error: error || null, context: context || null, contextId: contextId || null } });
  } catch {}
}

// Envia e-mail via API Saygo
export async function sendMail({ to, subject, html, text, context, contextId }) {
  if (!to) return;
  try {
    const s = await getSettings();
    if (!s.enabled) {
      await logEmail({ to, subject, status: 'error', error: 'E-mail desabilitado', context, contextId });
      return;
    }
    if (!s.apiUrl || !s.apiToken || !s.sender) {
      await logEmail({ to, subject, status: 'error', error: 'API de e-mail não configurada (apiUrl/apiToken/sender)', context, contextId });
      return;
    }
    const body = {
      sender: s.sender,
      to,
      subject,
      html,
      text: text || stripHtml(html || ''),
    };
    const r = await fetch(s.apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-access-token': s.apiToken,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status} ${errText.slice(0, 200)}`);
    }
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
