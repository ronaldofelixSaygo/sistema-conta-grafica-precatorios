// =====================================================================
// Engine de cálculo tributário — versão multi-NCM
//
// REGRA (replica a planilha "Calculo ICMS"):
// Para CADA grupo de NCM:
//   ProdutosBRL  = (FOB_USD + Acrescimo + Frete USD + Outros USD) * câmbio
//                  (frete entra em R$ se já vier em R$; aqui mantemos compatível com USD * câmbio)
//   SubTotal     = ProdutosBRL + II + PIS + COFINS + IPI + Siscomex/AFRMM
//   ICMS Normal  = SubTotal/(1-0.18) - SubTotal
//   ICMS NF AL   = SubTotal/(1-0.04) - SubTotal
//   ICMS Pagar   = SubTotal/(1-0.012) - SubTotal
// O TOTAL geral é a SOMA horizontal dos NCMs.
// =====================================================================

export const ALIQ_NORMAL  = 0.18;   // ICMS estadual default usado como "atual" quando não vier explícito
export const ALIQ_AL_NF   = 0.04;
export const ALIQ_AL_DIF  = 0.012;

export const DEFAULTS = {
  pis_aliq: 2.1,
  cofins_aliq: 9.65,
  ipi_aliq: 0.0,
  ii_aliq: 0.0,
  siscomex: 154.23,
  afrmm: 0.0,
  antidumping: 0.0,
};

const num = (v, fb = 0) => {
  if (v === '' || v == null) return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

// Calcula 1 grupo (1 NCM) e retorna detalhamento + 3 cenários
function calcularGrupoNcm(grp, cabecalho) {
  const taxa = num(cabecalho.taxa_cambio);
  const valorUSD = num(grp.valor_usd ?? grp.extension_usd_total);
  const acrescimoUSD = num(grp.acrescimo_usd);
  const freteUSD = num(grp.frete_usd);
  const outrosUSD = num(grp.outros_usd);

  const produtosBRL = (valorUSD + acrescimoUSD + freteUSD + outrosUSD) * taxa;
  const ii      = num(grp.ii);
  const pis     = num(grp.pis);
  const cofins  = num(grp.cofins);
  const ipi     = num(grp.ipi);
  const siscomex_afrmm = num(grp.siscomex) + num(grp.afrmm);
  const antidumping = num(grp.antidumping);

  const subtotal = produtosBRL + ii + pis + cofins + ipi + siscomex_afrmm + antidumping;

  const icmsAliqAtual = num(cabecalho.icms_aliq_estado, 18) / 100;  // 18% default
  const icmsNormal = icmsAliqAtual > 0 && icmsAliqAtual < 1 ? subtotal / (1 - icmsAliqAtual) - subtotal : 0;
  const icmsAlNf   = subtotal / (1 - ALIQ_AL_NF)  - subtotal;
  const icmsAlDif  = subtotal / (1 - ALIQ_AL_DIF) - subtotal;

  return {
    ncm: grp.ncm,
    breakdown: {
      valor_usd: valorUSD,
      acrescimo_usd: acrescimoUSD,
      frete_usd: freteUSD,
      outros_usd: outrosUSD,
      taxa_cambio: taxa,
      produtos_brl: produtosBRL,
      ii, pis, cofins, ipi,
      siscomex_afrmm,
      antidumping,
      subtotal,
    },
    cenarios: {
      atual:  { aliq: icmsAliqAtual, icms: icmsNormal, custo_total: subtotal + icmsNormal },
      al_nf:  { aliq: ALIQ_AL_NF,    icms: icmsAlNf,   custo_total: subtotal + icmsAlNf },
      al_dif: { aliq: ALIQ_AL_DIF,   icms: icmsAlDif,  custo_total: subtotal + icmsAlDif },
    },
  };
}

/**
 * Calcula a invoice agrupada por NCM. Aceita formatos:
 *  - { cabecalho, grupos: [{ ncm, valor_usd, ii, pis, cofins, ipi, siscomex, ... }] }
 *  - Legado (1 grupo só): { vmle_usd, ii_aliq, ipi_aliq, ... } — convertido internamente
 */
export function calcularInvoice(input = {}) {
  const cabecalho = {
    importadorNome: input.importadorNome || input.importador_nome || '',
    importadorCnpj: input.importadorCnpj || input.importador_cnpj || '',
    exportadorNome: input.exportadorNome || input.exportador_nome || '',
    exportadorPais: input.exportadorPais || input.exportador_pais || '',
    uf: input.uf || 'AL',
    taxa_cambio: num(input.taxa_cambio),
    icms_aliq_estado: num(input.icms_aliq_estado, 18),
  };

  // Compat: se vier no formato legado (sem grupos), monta 1 grupo único
  let grupos = Array.isArray(input.grupos) ? input.grupos : [];
  if (!grupos.length && (input.vmle_usd || input.ncm)) {
    grupos = [{
      ncm: input.ncm || 'N/D',
      valor_usd: num(input.vmle_usd),
      acrescimo_usd: 0,
      frete_usd: num(input.frete_usd),
      outros_usd: num(input.seguro_usd),
      // Os "valores" de impostos são calculados a partir das alíquotas como a engine antiga
      ii:    num(input.vmle_usd) * num(cabecalho.taxa_cambio) * (num(input.ii_aliq) / 100),
      ipi:   (num(input.vmle_usd) * num(cabecalho.taxa_cambio) + num(input.vmle_usd) * num(cabecalho.taxa_cambio) * (num(input.ii_aliq)/100)) * (num(input.ipi_aliq) / 100),
      pis:    num(input.vmle_usd) * num(cabecalho.taxa_cambio) * (num(input.pis_aliq, DEFAULTS.pis_aliq) / 100),
      cofins: num(input.vmle_usd) * num(cabecalho.taxa_cambio) * (num(input.cofins_aliq, DEFAULTS.cofins_aliq) / 100),
      siscomex: num(input.siscomex, DEFAULTS.siscomex),
      afrmm: num(input.afrmm),
      antidumping: num(input.antidumping),
    }];
  }

  const warnings = [];
  if (!cabecalho.taxa_cambio || cabecalho.taxa_cambio <= 0) warnings.push('Taxa de câmbio inválida ou ausente');
  if (!grupos.length) warnings.push('Nenhum grupo NCM informado');

  const porNcm = grupos.map(g => calcularGrupoNcm(g, cabecalho));

  // Total horizontal
  const total = porNcm.reduce((acc, g) => {
    acc.subtotal += g.breakdown.subtotal;
    acc.produtos_brl += g.breakdown.produtos_brl;
    acc.ii += g.breakdown.ii;
    acc.pis += g.breakdown.pis;
    acc.cofins += g.breakdown.cofins;
    acc.ipi += g.breakdown.ipi;
    acc.icms_atual += g.cenarios.atual.icms;
    acc.icms_al_nf += g.cenarios.al_nf.icms;
    acc.icms_al_dif += g.cenarios.al_dif.icms;
    return acc;
  }, { subtotal: 0, produtos_brl: 0, ii: 0, pis: 0, cofins: 0, ipi: 0, icms_atual: 0, icms_al_nf: 0, icms_al_dif: 0 });

  total.custo_atual    = total.subtotal + total.icms_atual;
  total.custo_al_nf    = total.subtotal + total.icms_al_nf;
  total.custo_al_dif   = total.subtotal + total.icms_al_dif;
  total.economia_al_nf  = total.custo_atual - total.custo_al_nf;
  total.economia_al_dif = total.custo_atual - total.custo_al_dif;
  total.reducao_icms_al_nf  = total.icms_atual - total.icms_al_nf;
  total.reducao_icms_al_dif = total.icms_atual - total.icms_al_dif;

  return {
    cabecalho,
    porNcm,
    total,
    creditos: {
      al_nf:  total.icms_al_nf,
      al_dif: total.icms_al_dif,
    },
    warnings,
    valid: warnings.length === 0,
  };
}
