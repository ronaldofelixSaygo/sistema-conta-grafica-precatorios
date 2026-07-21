import { prisma } from '../config/prisma.js';

// =====================================================================
// SLA em horário comercial (dias úteis).
// O prazo previsto de uma etapa = startedAt + slaHours, mas contando apenas
// horas dentro do expediente (SlaConfig.horaInicio..horaFim), de segunda a
// sexta, pulando os feriados cadastrados (Feriado).
//
// Fuso: BRT fixo (UTC-3). O Brasil não observa horário de verão desde 2019,
// então o offset é constante o ano todo — evita dependência de lib de timezone.
// =====================================================================

const BR_OFFSET_MS = 3 * 3600e3;            // BRT = UTC-3
const toBrt   = d => new Date(d.getTime() - BR_OFFSET_MS);  // wall-clock BRT lido via getUTC*
const fromBrt = d => new Date(d.getTime() + BR_OFFSET_MS);

// --- núcleo puro (coberto por testes) ---
// Recebe o instante inicial (UTC), as horas de SLA e o contexto
// { horaInicio, horaFim, holidaySet (YYYY-MM-DD), recurringSet (MM-DD) }.
// Retorna Date (UTC) do vencimento, ou null se não for calculável.
export function computeBusinessDeadline(startUtc, slaHours, ctx) {
  const { horaInicio = 8, horaFim = 18, holidaySet = new Set(), recurringSet = new Set() } = ctx || {};
  const dayHours = horaFim - horaInicio;
  if (!(dayHours > 0) || !(slaHours > 0) || !startUtc) return null;

  const isBiz = d => {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) return false;          // domingo/sábado
    const ymd = d.toISOString().slice(0, 10);
    if (holidaySet.has(ymd)) return false;
    if (recurringSet.has(ymd.slice(5))) return false;  // MM-DD recorrente
    return true;
  };
  const winStart = d => { const x = new Date(d); x.setUTCHours(horaInicio, 0, 0, 0); return x; };
  const winEnd   = d => { const x = new Date(d); x.setUTCHours(horaFim, 0, 0, 0); return x; };
  const nextDay  = d => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + 1); x.setUTCHours(horaInicio, 0, 0, 0); return x; };

  // Avança o cursor até cair dentro de uma janela de expediente válida.
  function advance(d) {
    let x = new Date(d);
    for (let g = 0; g < 4000; g++) {
      if (!isBiz(x)) { x = nextDay(x); continue; }
      const ws = winStart(x), we = winEnd(x);
      if (x < ws) return ws;
      if (x >= we) { x = nextDay(x); continue; }
      return x;
    }
    return x;
  }

  let cur = advance(toBrt(startUtc));
  let remMs = slaHours * 3600e3;
  for (let g = 0; g < 5000 && remMs > 0; g++) {
    const we = winEnd(cur);
    const avail = we.getTime() - cur.getTime();
    if (remMs <= avail) { cur = new Date(cur.getTime() + remMs); remMs = 0; }
    else { remMs -= avail; cur = advance(nextDay(cur)); }
  }
  return fromBrt(cur);
}

// --- contexto (config + feriados) com cache curto em memória ---
let _cache = null;         // { ctx, expiresAt }
const TTL_MS = 60_000;

export function invalidateSlaCache() { _cache = null; }

export async function getSlaContext() {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.ctx;

  const [cfg, feriados] = await Promise.all([
    prisma.slaConfig.findUnique({ where: { id: 1 } }).catch(() => null),
    prisma.feriado.findMany().catch(() => []),
  ]);

  const holidaySet = new Set();
  const recurringSet = new Set();
  for (const f of feriados) {
    if (!f?.data) continue;
    const ymd = new Date(f.data).toISOString().slice(0, 10);
    if (f.recorrente) recurringSet.add(ymd.slice(5));
    else holidaySet.add(ymd);
  }

  const ctx = {
    horaInicio: cfg?.horaInicio ?? 8,
    horaFim:    cfg?.horaFim ?? 18,
    holidaySet, recurringSet,
  };
  _cache = { ctx, expiresAt: Date.now() + TTL_MS };
  return ctx;
}

// --- config (singleton) ---
export async function getConfig() {
  const cfg = await prisma.slaConfig.findUnique({ where: { id: 1 } });
  return cfg || { id: 1, horaInicio: 8, horaFim: 18 };
}

export async function updateConfig({ horaInicio, horaFim }) {
  const hi = Math.max(0, Math.min(23, parseInt(horaInicio, 10)));
  const hf = Math.max(1, Math.min(24, parseInt(horaFim, 10)));
  if (isNaN(hi) || isNaN(hf) || hf <= hi) {
    const e = new Error('Horário inválido: fim deve ser maior que início'); e.status = 400; throw e;
  }
  const cfg = await prisma.slaConfig.upsert({
    where: { id: 1 },
    create: { id: 1, horaInicio: hi, horaFim: hf },
    update: { horaInicio: hi, horaFim: hf },
  });
  invalidateSlaCache();
  return cfg;
}

// --- feriados (CRUD simples) ---
export async function listFeriados() {
  return prisma.feriado.findMany({ orderBy: [{ recorrente: 'asc' }, { data: 'asc' }] });
}

export async function createFeriado({ data, nome, uf, recorrente }) {
  if (!data || !nome) { const e = new Error('Informe data e nome do feriado'); e.status = 400; throw e; }
  const d = new Date(String(data).slice(0, 10) + 'T00:00:00.000Z');
  if (isNaN(d.getTime())) { const e = new Error('Data inválida'); e.status = 400; throw e; }
  const f = await prisma.feriado.create({
    data: {
      data: d,
      nome: String(nome).trim(),
      uf: uf ? String(uf).trim().toUpperCase().slice(0, 2) : null,
      recorrente: !!recorrente,
    },
  });
  invalidateSlaCache();
  return f;
}

export async function deleteFeriado(id) {
  await prisma.feriado.delete({ where: { id: Number(id) } });
  invalidateSlaCache();
  return { ok: true };
}
