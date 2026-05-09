// =====================================================================
// NCM lookup — tributos federais, anuentes e ICMS por UF.
// Usa fallback hierárquico no NCM: tenta o código completo (8 dígitos),
// depois 6, 4 e 2. Retorna o melhor match disponível.
// =====================================================================
import { prisma } from '../config/prisma.js';

function clean(ncm) {
  return String(ncm || '').replace(/\D/g, '').slice(0, 8);
}

async function findTributoHierarquico(ncm) {
  const c = clean(ncm);
  const candidates = [c, c.slice(0, 6), c.slice(0, 4), c.slice(0, 2)].filter(s => s.length >= 2);
  for (const k of candidates) {
    if (!k) continue;
    const r = await prisma.ncmTributo.findUnique({ where: { ncm: k } });
    if (r) return { row: r, matchLevel: k.length };
  }
  return null;
}

async function findAnuentes(ncm) {
  const c = clean(ncm);
  // Pega todas as regras que sejam prefixo do NCM (8 → 6 → 4 → 2)
  const prefixos = [c, c.slice(0, 6), c.slice(0, 4), c.slice(0, 2)].filter(s => s.length >= 2);
  const rows = await prisma.ncmAnuente.findMany({
    where: { ncm: { in: prefixos } },
    orderBy: { ncm: 'desc' }, // primeiro o mais específico
  });
  // Deduplica por anuente (mantém o match mais específico)
  const seen = new Map();
  for (const r of rows) {
    if (!seen.has(r.anuente)) seen.set(r.anuente, r);
  }
  return [...seen.values()];
}

export async function lookupNcm(ncm, uf = null) {
  const c = clean(ncm);
  if (c.length < 2) {
    const e = new Error('NCM inválido (mínimo 2 dígitos)'); e.status = 400; throw e;
  }

  const tributoMatch = await findTributoHierarquico(c);
  const anuentes = await findAnuentes(c);

  let icmsAliq = null;
  let icmsObs = null;
  if (uf) {
    const icms = await prisma.icmsUf.findUnique({ where: { uf: String(uf).toUpperCase() } });
    if (icms) { icmsAliq = icms.aliq; icmsObs = icms.observacoes; }
  }

  const t = tributoMatch?.row;
  return {
    ncm: c,
    descricao: t?.descricao || null,
    ii_aliq: t?.ii_aliq ?? null,
    ipi_aliq: t?.ipi_aliq ?? null,
    pis_aliq: t?.pis_aliq ?? 2.1,
    cofins_aliq: t?.cofins_aliq ?? 9.65,
    icms_aliq: icmsAliq,
    icms_observacoes: icmsObs,
    uf: uf ? String(uf).toUpperCase() : null,
    matchLevel: tributoMatch?.matchLevel || 0, // 8 = exato, 6/4/2 = fallback, 0 = não encontrado
    matchTipo: tributoMatch
      ? (tributoMatch.matchLevel === 8 ? 'exato' : 'aproximado (capítulo/posição)')
      : 'não encontrado',
    anuentes: anuentes.map(a => ({
      anuente: a.anuente,
      descricao: a.descricao,
      obrigatorio: a.obrigatorio,
      ncm_match: a.ncm,
    })),
    found: !!tributoMatch,
  };
}
