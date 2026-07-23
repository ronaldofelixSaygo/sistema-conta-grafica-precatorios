// =====================================================================
// Cron job: re-notifica destinatários de mensagens de chat ainda não lidas.
//
// Roda a cada 1 minuto e verifica:
//   - mensagens com readAt = null
//   - cuja última notificação foi há mais de `chatNotifyMinutes` minutos
//     (ou nunca foi notificada)
//
// Pra cada mensagem qualificada, dispara e-mail e atualiza `lastChatNotifiedAt`.
// O usuário pode configurar o intervalo em Parâmetros > E-mail
// (campo `chatNotifyMinutes`, default 15min).
// =====================================================================
import { prisma } from '../config/prisma.js';
import * as email from '../services/email.service.js';

const TICK_MS = 60_000; // checa a cada 1 min
let _running = false;

async function tick() {
  if (_running) return;
  _running = true;
  try {
    const settings = await email.getSettingsSafe?.() || null;
    if (!settings) return;
    if (!settings.enabled || settings.notifyChat === false) return;
    const minutes = Number(settings.chatNotifyMinutes) || 15;
    const cutoff = new Date(Date.now() - minutes * 60_000);

    // Mensagens elegíveis: não lidas, criadas há mais de `minutes` min
    // (pra não duplicar com o e-mail imediato), e cuja última notificação
    // foi há mais de `minutes` min (ou nunca).
    const msgs = await prisma.message.findMany({
      where: {
        readAt: null,
        createdAt: { lt: cutoff },
        OR: [
          { lastChatNotifiedAt: null, createdAt: { lt: cutoff } },
          { lastChatNotifiedAt: { lt: cutoff } },
        ],
      },
      include: {
        from: { select: { id: true, name: true, email: true } },
        to:   { select: { id: true, name: true, email: true, active: true, receberEmails: true } },
      },
      take: 50, // limite por tick pra não estourar
      orderBy: { createdAt: 'asc' },
    });

    for (const m of msgs) {
      if (!m.to?.active || !m.to.email) continue;
      try {
        await email.notifyChatMessage({
          messageId: m.id, fromUser: m.from, toUser: m.to, content: m.content,
        });
        await prisma.message.update({
          where: { id: m.id }, data: { lastChatNotifiedAt: new Date() },
        });
      } catch (e) {
        console.error('[chat-reminders] falha pra msg', m.id, ':', e.message);
      }
    }
  } catch (e) {
    console.error('[chat-reminders] tick falhou:', e.message);
  } finally {
    _running = false;
  }
}

let _interval = null;
export function startChatRemindersJob() {
  if (_interval) return;
  console.log('[chat-reminders] iniciado (tick a cada 60s)');
  _interval = setInterval(tick, TICK_MS);
  // primeira passada em 30s pra não rodar logo no boot
  setTimeout(tick, 30_000);
}

export function stopChatRemindersJob() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}
