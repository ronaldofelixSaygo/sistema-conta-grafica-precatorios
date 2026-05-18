// =====================================================================
// Envio de e-mail via API interna Saygo (mesmo padrão do projeto
// Indicadores_Comercial_Bitrix). POST com x-access-token.
// =====================================================================
import { prisma } from '../config/prisma.js';

// PERF/SAFETY: cache curto (5min) — getSettings é chamado em todo envio de e-mail
// e em vários hot paths (advanceStep, completeStage, moveCard). Sem cache,
// era 1 query por evento.
let _settingsCache = { data: null, expiresAt: 0 };
function invalidateSettingsCache() { _settingsCache = { data: null, expiresAt: 0 }; }

async function getSettings() {
  if (_settingsCache.data && _settingsCache.expiresAt > Date.now()) {
    return _settingsCache.data;
  }
  let s;
  try {
    s = await prisma.emailSettings.findUnique({ where: { id: 'default' } });
  } catch (e) {
    // Defensivo: se schema novo (com colunas que talvez não existam ainda no
    // banco), evita quebrar TODO o fluxo de e-mail. Lê apenas colunas seguras.
    console.warn('[email] getSettings falhou no findUnique — usando SELECT reduzido:', e.message);
    try {
      const rows = await prisma.$queryRaw`
        SELECT id, enabled, "apiUrl", "apiToken", sender,
               "notifyKanbanStageChange", "notifyKanbanStageDone",
               "notifyPartnerRequest", "notifyCreditRequest",
               "notifyKanbanStageChangeRoles", "notifyKanbanStageDoneRoles",
               "notifyPartnerRequestRoles", "notifyCreditRequestRoles",
               "briefingRecipients", "updatedAt"
        FROM email_settings WHERE id = 'default' LIMIT 1
      `;
      s = Array.isArray(rows) && rows.length ? rows[0] : null;
    } catch (e2) {
      console.error('[email] getSettings raw query falhou:', e2.message);
      s = null;
    }
  }
  if (!s) {
    try { s = await prisma.emailSettings.create({ data: { id: 'default' } }); }
    catch { s = { id: 'default', enabled: false }; }
  }
  _settingsCache = { data: s, expiresAt: Date.now() + 5 * 60 * 1000 };
  return s;
}

export async function getSettingsSafe() {
  const s = await getSettings();
  // Não vaza o valor do token, só sinaliza presença
  return {
    enabled: !!s.enabled,
    apiUrl: s.apiUrl || '',
    sender: s.sender || '',
    hasApiToken: !!(s.apiToken && s.apiToken.length > 0),
    notifyKanbanStageChange:     !!s.notifyKanbanStageChange,
    notifyKanbanStageDone:       !!s.notifyKanbanStageDone,
    notifyPartnerRequest:        !!s.notifyPartnerRequest,
    notifyCreditRequest:         s.notifyCreditRequest !== false,
    notifyDesoneracaoStepChange: s.notifyDesoneracaoStepChange !== false,
    notifyKanbanStageChangeRoles:      s.notifyKanbanStageChangeRoles      || ['ADM','SAYGO','PARTNER','CLIENT'],
    notifyKanbanStageDoneRoles:        s.notifyKanbanStageDoneRoles        || ['ADM','SAYGO','PARTNER','CLIENT'],
    notifyPartnerRequestRoles:         s.notifyPartnerRequestRoles         || ['ADM','SAYGO','PARTNER'],
    notifyCreditRequestRoles:          s.notifyCreditRequestRoles          || ['ADM','SAYGO','PARTNER'],
    notifyDesoneracaoStepChangeRoles:  s.notifyDesoneracaoStepChangeRoles  || ['ADM','SAYGO','PARTNER','CLIENT'],
    briefingRecipients: s.briefingRecipients || '',
    updatedAt: s.updatedAt,
  };
}

const ROLE_KEYS = ['ADM','SAYGO','PARTNER','CLIENT'];
function sanitizeRoles(arr) {
  if (!Array.isArray(arr)) return ROLE_KEYS;
  const out = arr.filter(r => ROLE_KEYS.includes(r));
  return out.length ? out : ROLE_KEYS;
}

export async function updateSettings(data) {
  const upd = {};
  if (data.enabled  !== undefined) upd.enabled  = !!data.enabled;
  if (data.apiUrl   !== undefined) upd.apiUrl   = data.apiUrl   || null;
  if (data.sender   !== undefined) upd.sender   = data.sender   || null;
  // Token: vazio ou '***' = manter o atual; qualquer outra string não-vazia salva
  if (data.apiToken !== undefined && data.apiToken !== '' && data.apiToken !== '***') {
    upd.apiToken = data.apiToken;
  }
  if (data.briefingRecipients !== undefined) upd.briefingRecipients = data.briefingRecipients || null;
  // Triggers
  if (data.notifyKanbanStageChange !== undefined) upd.notifyKanbanStageChange = !!data.notifyKanbanStageChange;
  if (data.notifyKanbanStageDone   !== undefined) upd.notifyKanbanStageDone   = !!data.notifyKanbanStageDone;
  if (data.notifyPartnerRequest        !== undefined) upd.notifyPartnerRequest         = !!data.notifyPartnerRequest;
  if (data.notifyCreditRequest         !== undefined) upd.notifyCreditRequest          = !!data.notifyCreditRequest;
  if (data.notifyDesoneracaoStepChange !== undefined) upd.notifyDesoneracaoStepChange  = !!data.notifyDesoneracaoStepChange;
  // Roles por trigger
  if (data.notifyKanbanStageChangeRoles      !== undefined) upd.notifyKanbanStageChangeRoles      = sanitizeRoles(data.notifyKanbanStageChangeRoles);
  if (data.notifyKanbanStageDoneRoles        !== undefined) upd.notifyKanbanStageDoneRoles        = sanitizeRoles(data.notifyKanbanStageDoneRoles);
  if (data.notifyPartnerRequestRoles         !== undefined) upd.notifyPartnerRequestRoles         = sanitizeRoles(data.notifyPartnerRequestRoles);
  if (data.notifyCreditRequestRoles          !== undefined) upd.notifyCreditRequestRoles          = sanitizeRoles(data.notifyCreditRequestRoles);
  if (data.notifyDesoneracaoStepChangeRoles  !== undefined) upd.notifyDesoneracaoStepChangeRoles  = sanitizeRoles(data.notifyDesoneracaoStepChangeRoles);

  const r = await prisma.emailSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...upd },
    update: upd,
  });
  invalidateSettingsCache(); // garante que próxima leitura traz o novo valor
  return r;
}

async function logEmail({ to, subject, status, error, context, contextId }) {
  try {
    await prisma.emailLog.create({ data: { to, subject, status, error: error || null, context: context || null, contextId: contextId || null } });
  } catch {}
}

// Envia e-mail via API Saygo (não-strict — engole erros e loga)
export async function sendMail({ to, subject, html, text, context, contextId }) {
  if (!to) return;
  try {
    const s = await getSettings();
    if (!s.enabled) {
      await logEmail({ to: String(to), subject, status: 'error', error: 'E-mail desabilitado', context, contextId });
      return;
    }
    if (!s.apiUrl || !s.apiToken || !s.sender) {
      await logEmail({ to: String(to), subject, status: 'error', error: 'API de e-mail não configurada (apiUrl/apiToken/sender)', context, contextId });
      return;
    }
    const body = buildSaygoPayload({ sender: s.sender, to, subject, html, text });
    const r = await fetch(s.apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-token': s.apiToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status} ${errText.slice(0, 200)}`);
    }
    await logEmail({ to: String(to), subject, status: 'sent', context, contextId });
  } catch (e) {
    console.error('[email] erro:', e.message);
    await logEmail({ to: String(to), subject, status: 'error', error: e.message, context, contextId });
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

// Resolve destinatários para um cliente, respeitando os roles configurados.
// allowedRoles: array tipo ['ADM','SAYGO','PARTNER','CLIENT'] — quais perfis devem receber.
async function recipientsForCliente(clienteId, allowedRoles = ['ADM','SAYGO','PARTNER','CLIENT']) {
  const cli = await prisma.cliente.findUnique({
    where: { id: clienteId },
    include: { user: { select: { email: true } } },
  });
  if (!cli) return [];
  const emails = new Set();
  if (allowedRoles.includes('CLIENT') && cli.user?.email) emails.add(cli.user.email);
  if (allowedRoles.includes('PARTNER') && cli.escritorio) {
    // Match case-insensitive com trim no escritorio — mesmo padrão do scope.
    // Sem isso, NBSP/case quebra silenciosamente quem deveria receber.
    const office = String(cli.escritorio).trim();
    const partners = await prisma.user.findMany({
      where: {
        role: 'PARTNER', active: true, email: { not: null },
        officeName: { equals: office, mode: 'insensitive' },
      },
      select: { email: true },
    });
    for (const p of partners) emails.add(p.email);
  }
  const staffRoles = ['SAYGO','ADM'].filter(r => allowedRoles.includes(r));
  if (staffRoles.length) {
    const staff = await prisma.user.findMany({
      where: { role: { in: staffRoles }, active: true, email: { not: null } },
      select: { email: true },
    });
    for (const s of staff) emails.add(s.email);
  }
  return [...emails];
}

// Payload da API interna Saygo (mesmo formato usado no painel-resultados-saygo):
//   { sender, toRecipients: string[], subject, content }
// O lambda itera `toRecipients` — por isso estourava `.map() of undefined`
// quando mandávamos `to` em vez de `toRecipients`.
function buildSaygoPayload({ sender, to, subject, html /*, text */ }) {
  const toRecipients = Array.isArray(to)
    ? to
    : String(to || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
  return {
    sender,
    toRecipients,
    subject,
    content: html || '',
  };
}

// sendMail que NÃO engole erros — usado pelo botão "Testar"
export async function sendMailStrict({ to, subject, html, text, context, contextId }) {
  if (!to) throw new Error('Destinatário vazio');
  const s = await getSettings();
  if (!s.enabled) {
    await logEmail({ to, subject, status: 'error', error: 'E-mail desabilitado', context, contextId });
    throw new Error('E-mail desabilitado nas configurações');
  }
  if (!s.apiUrl || !s.apiToken || !s.sender) {
    const missing = [];
    if (!s.apiUrl)   missing.push('email_api_url');
    if (!s.apiToken) missing.push('email_api_token');
    if (!s.sender)   missing.push('email_sender');
    const err = `API de e-mail não configurada: faltam ${missing.join(', ')}`;
    await logEmail({ to, subject, status: 'error', error: err, context, contextId });
    throw new Error(err);
  }
  const body = buildSaygoPayload({ sender: s.sender, to, subject, html, text });
  console.log('[email] POST', s.apiUrl, '\nbody:', JSON.stringify(body));

  let r, respText;
  try {
    r = await fetch(s.apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-token': s.apiToken },
      body: JSON.stringify(body),
    });
    respText = await r.text().catch(() => '');
    console.log('[email] response', r.status, respText);
  } catch (netErr) {
    console.error('[email] network error', netErr);
    await logEmail({ to: String(to), subject, status: 'error', error: `Network: ${netErr.message}`, context, contextId });
    throw new Error(`Network error: ${netErr.message}`);
  }

  if (!r.ok) {
    const err = `HTTP ${r.status} ${respText.slice(0, 500)}`;
    await logEmail({ to: String(to), subject, status: 'error', error: err, context, contextId });
    throw new Error(err);
  }
  await logEmail({ to: String(to), subject, status: 'sent', context, contextId });
  return { ok: true, response: respText.slice(0, 500) };
}

export async function notifyStageChange({ cardId, fromStage, toStage, byUser }) {
  try {
    const s = await getSettings();
    console.log('[email] notifyStageChange', { cardId, fromStage, toStage, enabled: s.enabled, flag: s.notifyKanbanStageChange });
    if (!s.enabled) {
      console.warn('[email] notifyStageChange skip: email desabilitado');
      return;
    }
    if (!s.notifyKanbanStageChange) {
      console.warn('[email] notifyStageChange skip: trigger notifyKanbanStageChange desativado (vá em Parâmetros > E-mail e marque)');
      return;
    }
    const card = await prisma.kanbanCard.findUnique({
      where: { id: cardId }, include: { cliente: true },
    });
    if (!card) { console.warn('[email] notifyStageChange skip: card não encontrado', cardId); return; }
    const roles = Array.isArray(s.notifyKanbanStageChangeRoles) ? s.notifyKanbanStageChangeRoles : ['ADM','SAYGO','PARTNER','CLIENT'];
    const tos = await recipientsForCliente(card.clienteId, roles);
    if (!tos.length) {
      console.warn('[email] notifyStageChange skip: nenhum destinatário pro cliente', card.clienteId, 'roles:', roles);
      await logEmail({ to: '(sem destinatários)', subject: `Kanban mudança ${fromStage}→${toStage}`, status: 'error', error: `Sem destinatários nas roles ${roles.join(',')} pro cliente ${card.cliente.nome}`, context: 'kanban_stage_change', contextId: cardId });
      return;
    }
    const stages = await prisma.kanbanStageDef.findMany();
    const stgFrom = stages.find(s => s.key === fromStage)?.label || fromStage;
    const stgTo   = stages.find(s => s.key === toStage)?.label   || toStage;
    const tpl = templateKanbanStageChange({ clienteName: card.cliente.nome, fromStage: stgFrom, toStage: stgTo, byUserName: byUser?.name });
    console.log('[email] notifyStageChange enviando pra', tos);
    for (const to of tos) {
      try { await sendMail({ ...tpl, to, context: 'kanban_stage_change', contextId: cardId }); }
      catch (e) { console.error('[email] notifyStageChange falha pra', to, ':', e.message); }
    }
  } catch (err) {
    console.error('[email] notifyStageChange CRASH:', err);
    // Persiste no log pra ficar visível em Parâmetros > E-mail
    await logEmail({
      to: '(crash)', subject: `Kanban ${fromStage}→${toStage}`, status: 'error',
      error: `Crash: ${err?.message || String(err)}`,
      context: 'kanban_stage_change', contextId: cardId,
    }).catch(() => {});
    throw err; // re-raise pra o .catch externo logar também
  }
}

export async function notifyStageDone({ cardId, stageKey, byUser }) {
  try {
    const s = await getSettings();
    console.log('[email] notifyStageDone', { cardId, stageKey, enabled: s.enabled, flag: s.notifyKanbanStageDone });
    if (!s.enabled) { console.warn('[email] notifyStageDone skip: email desabilitado'); return; }
    if (!s.notifyKanbanStageDone) { console.warn('[email] notifyStageDone skip: trigger desativado'); return; }
    const card = await prisma.kanbanCard.findUnique({
      where: { id: cardId }, include: { cliente: true },
    });
    if (!card) return;
    const roles = Array.isArray(s.notifyKanbanStageDoneRoles) ? s.notifyKanbanStageDoneRoles : ['ADM','SAYGO','PARTNER','CLIENT'];
    const tos = await recipientsForCliente(card.clienteId, roles);
    if (!tos.length) {
      console.warn('[email] notifyStageDone skip: nenhum destinatário pro cliente', card.clienteId);
      await logEmail({ to: '(sem destinatários)', subject: `Kanban etapa ${stageKey} concluída`, status: 'error', error: `Sem destinatários nas roles ${roles.join(',')}`, context: 'kanban_stage_done', contextId: cardId });
      return;
    }
    const stg = await prisma.kanbanStageDef.findFirst({ where: { key: stageKey } });
    const tpl = templateKanbanStageDone({ clienteName: card.cliente.nome, stage: stg?.label || stageKey, byUserName: byUser?.name });
    console.log('[email] notifyStageDone enviando pra', tos);
    for (const to of tos) {
      try { await sendMail({ ...tpl, to, context: 'kanban_stage_done', contextId: cardId }); }
      catch (e) { console.error('[email] notifyStageDone falha pra', to, ':', e.message); }
    }
  } catch (err) {
    console.error('[email] notifyStageDone CRASH:', err);
    await logEmail({
      to: '(crash)', subject: `Kanban ${stageKey} concluída`, status: 'error',
      error: `Crash: ${err?.message || String(err)}`,
      context: 'kanban_stage_done', contextId: cardId,
    }).catch(() => {});
    throw err;
  }
}

export async function notifyPartnerRequest({ requestId, byUser }) {
  const s = await getSettings();
  if (!s.enabled || !s.notifyPartnerRequest) return;
  const req = await prisma.partnerRequest.findUnique({
    where: { id: requestId }, include: { cliente: true },
  });
  if (!req) return;
  const roles = Array.isArray(s.notifyPartnerRequestRoles) ? s.notifyPartnerRequestRoles : ['ADM','SAYGO','PARTNER'];
  const tos = await recipientsForCliente(req.clienteId, roles);
  if (!tos.length) return;
  const tpl = templatePartnerRequest({
    clienteName: req.cliente.nome, type: req.type, message: req.message, byUserName: byUser?.name,
  });
  for (const to of tos) sendMail({ ...tpl, to, context: 'partner_request', contextId: requestId });
}

// Eventos suportados: 'sent' (cliente enviou), 'in_progress' (parceiro aceitou),
// 'resolved' (parceiro concluiu), 'canceled' (cliente cancelou).
export async function notifyCreditRequest({ requestId, event = 'sent', byUser }) {
  const s = await getSettings();
  if (!s.enabled || !s.notifyCreditRequest) return;
  const req = await prisma.creditRequest.findUnique({
    where: { id: requestId }, include: { cliente: true },
  });
  if (!req) return;
  const roles = Array.isArray(s.notifyCreditRequestRoles) ? s.notifyCreditRequestRoles : ['ADM','SAYGO','PARTNER'];
  const tos = await recipientsForCliente(req.clienteId, roles);
  if (!tos.length) return;
  const EVT_LABEL = {
    sent:        'Nova solicitação enviada',
    in_progress: 'Em andamento (parceiro aceitou)',
    resolved:    'Solicitação concluída',
    canceled:    'Solicitação cancelada',
  };
  const EVT_SHORT = {
    sent:        'nova solicitação',
    in_progress: 'em andamento',
    resolved:    'concluída',
    canceled:    'cancelada',
  };
  const label = EVT_LABEL[event] || event;
  const short = EVT_SHORT[event] || event;
  const tpl = {
    subject: `[Solicitação de Créditos] ${req.cliente.nome} — ${short}`,
    html: baseTemplate(`Solicitação de Créditos — ${req.cliente.nome}`, `
      <p>Status: <strong>${escape(label)}</strong></p>
      <p style="background:#f4f5f8;padding:12px;border-radius:6px">
        <strong>Cliente:</strong> ${escape(req.cliente.nome)}<br>
        <strong>Modalidade:</strong> ${escape(req.modalidade)}<br>
        <strong>Créditos:</strong> R$ ${Number(req.creditosACompar||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}<br>
        <strong>Por:</strong> ${escape(byUser?.name || '—')}
      </p>
      <p>Acesse o sistema para ver os detalhes.</p>
    `),
  };
  for (const to of tos) sendMail({ ...tpl, to, context: `credit_request_${event}`, contextId: requestId });
}

// =====================================================================
// Desonerações — notifica avanço de etapa, aprovação e cancelamento.
// =====================================================================
const DES_STEP_LABELS = {
  DOCS_DESPACHANTE: '1. Docs do Despachante',
  EMISSAO_DMI:      '2. Emissão DMI',
  EMISSAO_NF:       '3. Emissão NFs',
  VALIDACAO_NF:     '4. Validação NFs',
  PROTOCOLO_ICMS:   '5. Protocolo ICMS',
  CONCLUIDO:        'Concluído',
};

export function templateDesoneracaoStepChange({ clienteName, fromStep, toStep, byUserName, motivo }) {
  return {
    subject: `[Desoneração] ${clienteName}: ${toStep}`,
    html: baseTemplate(`Desoneração — ${clienteName}`, `
      <p>O processo de desoneração avançou de etapa.</p>
      <p style="background:#f4f5f8;padding:12px;border-radius:6px">
        <strong>De:</strong> ${escape(fromStep || '—')}<br>
        <strong>Para:</strong> ${escape(toStep)}<br>
        <strong>Por:</strong> ${escape(byUserName || '—')}
      </p>
      ${motivo ? `<p><strong>Observação:</strong> ${escape(motivo)}</p>` : ''}
      <p>Acesse o sistema para tomar as próximas ações.</p>
    `),
  };
}

// Notifica avanço de etapa no fluxo de desoneração. Chamada como fire-and-forget
// (setImmediate) — nunca bloqueia a operação.
export async function notifyDesoneracaoStepAdvance({ desoneracaoId, fromStep, toStep, byUser, motivo }) {
  const s = await getSettings();
  console.log('[email] notifyDesoneracaoStepAdvance', { desoneracaoId, fromStep, toStep, enabled: s.enabled, flag: s.notifyDesoneracaoStepChange });
  if (!s.enabled) { console.warn('[email] notifyDesoneracaoStepAdvance skip: email desabilitado'); return; }
  if (s.notifyDesoneracaoStepChange === false) {
    console.warn('[email] notifyDesoneracaoStepAdvance skip: trigger desativado em Parâmetros > E-mail');
    return;
  }
  const des = await prisma.desoneracao.findUnique({
    where: { id: desoneracaoId }, include: { cliente: true },
  });
  if (!des) return;
  const roles = Array.isArray(s.notifyDesoneracaoStepChangeRoles) ? s.notifyDesoneracaoStepChangeRoles : ['ADM','SAYGO','PARTNER','CLIENT'];
  const tos = await recipientsForCliente(des.clienteId, roles);
  if (!tos.length) {
    console.warn('[email] notifyDesoneracaoStepAdvance skip: nenhum destinatário pro cliente', des.clienteId);
    await logEmail({ to: '(sem destinatários)', subject: `Desoneração ${fromStep}→${toStep}`, status: 'error', error: `Sem destinatários nas roles ${roles.join(',')} pro cliente ${des.cliente.nome}`, context: 'desoneracao_step_change', contextId: desoneracaoId });
    return;
  }
  const tpl = templateDesoneracaoStepChange({
    clienteName: des.cliente.nome,
    fromStep: DES_STEP_LABELS[fromStep] || fromStep,
    toStep:   DES_STEP_LABELS[toStep]   || toStep,
    byUserName: byUser?.name,
    motivo,
  });
  console.log('[email] notifyDesoneracaoStepAdvance enviando pra', tos);
  for (const to of tos) {
    try { await sendMail({ ...tpl, to, context: 'desoneracao_step_change', contextId: desoneracaoId }); }
    catch (e) { console.error('[email] notifyDesoneracaoStepAdvance falha pra', to, ':', e.message); }
  }
}

export async function sendTestMail(to) {
  const tpl = {
    subject: '[TESTE] Vision · Conta Gráfica',
    html: baseTemplate('E-mail de teste', `
      <p>Este é um e-mail de teste do envio do sistema.</p>
      <p>Se você recebeu isso, está tudo configurado certinho!</p>
      <p>Data/hora: ${new Date().toLocaleString('pt-BR')}</p>
    `),
  };
  return sendMailStrict({ ...tpl, to, context: 'test' });
}

