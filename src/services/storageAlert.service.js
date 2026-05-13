// =====================================================================
// Alerta de storage: quando o banco passa de 80% do limite do plano Neon
// free (500 MB), dispara e-mail pra todos os ADM e SAYGO. Throttled pra
// no máximo 1 envio a cada 6h (registro em SystemAlert).
// =====================================================================
import { prisma } from '../config/prisma.js';
import * as email from './email.service.js';

const LIMIT_BYTES   = 500 * 1024 * 1024; // 500 MB (plano Free Neon)
const THRESHOLD_PCT = 80;                 // dispara quando >= 80%
const COOLDOWN_MS   = 6 * 60 * 60 * 1000; // 6h entre disparos
const ALERT_KEY     = 'storage_80_percent';

export async function getStorageUsage() {
  try {
    const r = await prisma.$queryRawUnsafe(`SELECT pg_database_size(current_database())::bigint AS bytes`);
    const used = Number(r[0]?.bytes || 0);
    return {
      usedBytes: used,
      limitBytes: LIMIT_BYTES,
      percent: Math.round((used / LIMIT_BYTES) * 100),
    };
  } catch (e) {
    console.warn('[storageAlert] getStorageUsage failed:', e.message);
    return { usedBytes: 0, limitBytes: LIMIT_BYTES, percent: 0, error: e.message };
  }
}

export async function checkAndAlertIfNeeded() {
  const usage = await getStorageUsage();
  if (usage.percent < THRESHOLD_PCT) return { triggered: false, usage };

  // Throttle: olha último envio
  const last = await prisma.systemAlert.findUnique({ where: { key: ALERT_KEY } });
  if (last && (Date.now() - last.lastSentAt.getTime()) < COOLDOWN_MS) {
    return { triggered: false, throttled: true, usage, nextAt: new Date(last.lastSentAt.getTime() + COOLDOWN_MS) };
  }

  // Coleta destinatários: todos ADM e SAYGO ativos com email
  const staff = await prisma.user.findMany({
    where: { role: { in: ['ADM','SAYGO'] }, active: true, email: { not: null } },
    select: { email: true, name: true },
  });
  if (!staff.length) return { triggered: false, reason: 'sem destinatários', usage };

  const fmtMB = b => (b / 1024 / 1024).toFixed(1) + ' MB';
  const subject = `⚠ Vision Conta Gráfica — Storage em ${usage.percent}%`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:1rem">
      <h2 style="color:#f59e0b">⚠ Alerta de Storage</h2>
      <p>O banco do <strong>Vision · Conta Gráfica</strong> está usando <strong>${usage.percent}%</strong>
      do limite do plano Neon Free (500 MB).</p>
      <table style="border-collapse:collapse;margin:1rem 0">
        <tr><td style="padding:6px 12px;color:#666">Usado:</td><td style="padding:6px 12px"><strong>${fmtMB(usage.usedBytes)}</strong></td></tr>
        <tr><td style="padding:6px 12px;color:#666">Limite:</td><td style="padding:6px 12px">${fmtMB(usage.limitBytes)}</td></tr>
        <tr><td style="padding:6px 12px;color:#666">Disponível:</td><td style="padding:6px 12px">${fmtMB(usage.limitBytes - usage.usedBytes)}</td></tr>
      </table>
      <p><strong>Ação recomendada:</strong></p>
      <ul>
        <li>Acesse <a href="https://console.neon.tech">console.neon.tech</a> pra fazer upgrade (Hobby/Launch $5/mês com 7 dias de PITR)</li>
        <li>Ou planeje a migração dos anexos pra storage externo (Cloudflare R2, Backblaze B2)</li>
      </ul>
      <p style="color:#666;font-size:12px;margin-top:1.5rem">Detalhamento por tipo: <strong>Parâmetros → Storage</strong></p>
      <p style="color:#999;font-size:11px">Este aviso é enviado no máximo a cada 6h enquanto o uso estiver acima de 80%.</p>
    </div>`;
  const text = `Storage em ${usage.percent}% (${fmtMB(usage.usedBytes)} de ${fmtMB(usage.limitBytes)}). Considere upgrade no Neon ou migração pra storage externo.`;

  for (const u of staff) {
    try {
      await email.sendMail({ to: u.email, subject, html, text, context: 'storage_alert' });
    } catch (e) {
      console.warn('[storageAlert] sendMail failed for', u.email, ':', e.message);
    }
  }

  await prisma.systemAlert.upsert({
    where: { key: ALERT_KEY },
    create: { key: ALERT_KEY, lastSentAt: new Date(), payload: usage },
    update: { lastSentAt: new Date(), payload: usage },
  });

  return { triggered: true, usage, sentTo: staff.length };
}

// Inicia uma verificação periódica. Chamado uma vez no boot.
// Roda a cada 1h. Se já está acima de 80%, o cooldown interno cuida do
// rate-limit (1 e-mail a cada 6h).
let _intervalHandle = null;
export function startStorageMonitor() {
  if (_intervalHandle) return;
  // Primeira verificação 30s após boot (deixa o app responder primeiro)
  setTimeout(() => { checkAndAlertIfNeeded().catch(() => {}); }, 30_000);
  // Verificações subsequentes a cada 1h
  _intervalHandle = setInterval(() => {
    checkAndAlertIfNeeded().catch(() => {});
  }, 60 * 60 * 1000);
}
