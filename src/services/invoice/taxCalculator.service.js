// =====================================================================
// Engine de cálculo tributário — porting do tax_calculator.py
//
// LÓGICA DO COMPARATIVO:
// - Atual: ICMS calculado pela alíquota do estado (por dentro)
// - Alagoas NF 4%:    NF = Subtotal / (1 - 0.04)   -> ICMS = NF - Subtotal
// - Alagoas Dif 1.2%: NF = Subtotal / (1 - 0.012)  -> ICMS = NF - Subtotal
// - Economia = Custo_atual - NF_Alagoas
// =====================================================================

export const ALIQ_AL_NF  = 0.04;
export const ALIQ_AL_DIF = 0.012;

// Defaults idênticos ao simulate-invoice.py
export const DEFAULTS = {
  pis_aliq: 2.1,
  cofins_aliq: 9.65,
  ipi_aliq: 0.0,
  siscomex: 154.23,
  afrmm: 0.0,
  antidumping: 0.0,
};

function num(v, fallback = 0) {
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Calcula a simulação de invoice.
 * @param {object} input
 *   importadorNome, importadorCnpj, exportadorNome, exportadorPais, ncm, uf,
 *   vmle_usd, frete_usd, seguro_usd, taxa_cambio,
 *   ii_aliq, ipi_aliq, pis_aliq, cofins_aliq, icms_aliq_estado,
 *   siscomex, afrmm, antidumping
 * @returns {object} resultado com inputs normalizados + cenários
 */
export function calcularInvoice(input = {}) {
  const inputs = {
    importadorNome:  input.importadorNome || input.importador_nome || '',
    importadorCnpj:  input.importadorCnpj || input.importador_cnpj || '',
    exportadorNome:  input.exportadorNome || input.exportador_nome || '',
    exportadorPais:  input.exportadorPais || input.exportador_pais || '',
    ncm:             input.ncm || '',
    uf:              input.uf || '',

    vmle_usd:        num(input.vmle_usd),
    frete_usd:       num(input.frete_usd),
    seguro_usd:      num(input.seguro_usd),
    taxa_cambio:     num(input.taxa_cambio),

    ii_aliq:         num(input.ii_aliq),
    ipi_aliq:        num(input.ipi_aliq, DEFAULTS.ipi_aliq),
    pis_aliq:        num(input.pis_aliq, DEFAULTS.pis_aliq),
    cofins_aliq:     num(input.cofins_aliq, DEFAULTS.cofins_aliq),
    icms_aliq_estado: num(input.icms_aliq_estado),
    siscomex:        num(input.siscomex, DEFAULTS.siscomex),
    afrmm:           num(input.afrmm, DEFAULTS.afrmm),
    antidumping:     num(input.antidumping, DEFAULTS.antidumping),
  };

  // Validações
  const warnings = [];
  if (inputs.vmle_usd <= 0)        warnings.push('Valor FOB (vmle_usd) deve ser maior que zero');
  if (inputs.taxa_cambio <= 0)     warnings.push('Taxa de câmbio deve ser maior que zero');
  if (inputs.ii_aliq < 0)          warnings.push('Alíquota II não pode ser negativa');
  if (inputs.icms_aliq_estado < 0) warnings.push('Alíquota ICMS não pode ser negativa');
  if (inputs.icms_aliq_estado >= 100) warnings.push('Alíquota ICMS deve ser menor que 100%');

  const icmsAliq = inputs.icms_aliq_estado / 100;

  const vmld_usd  = inputs.vmle_usd + inputs.frete_usd + inputs.seguro_usd;
  const va_brl    = vmld_usd * inputs.taxa_cambio;
  const ii_valor  = va_brl * (inputs.ii_aliq / 100);
  const ipi_valor = (va_brl + ii_valor) * (inputs.ipi_aliq / 100);
  const pis_valor = va_brl * (inputs.pis_aliq / 100);
  const cof_valor = va_brl * (inputs.cofins_aliq / 100);

  const subtotal = va_brl + ii_valor + ipi_valor + pis_valor + cof_valor
                 + inputs.siscomex + inputs.afrmm + inputs.antidumping;

  const icms_atual    = icmsAliq > 0 ? subtotal / (1 - icmsAliq) - subtotal : 0;
  const custo_atual   = subtotal + icms_atual;

  const nf_al_nf      = subtotal / (1 - ALIQ_AL_NF);
  const icms_al_nf    = nf_al_nf - subtotal;

  const nf_al_dif     = subtotal / (1 - ALIQ_AL_DIF);
  const icms_al_dif   = nf_al_dif - subtotal;

  const economia_vs_al_nf  = custo_atual - nf_al_nf;
  const economia_vs_al_dif = custo_atual - nf_al_dif;

  const reducao_icms_al_nf  = icms_atual - icms_al_nf;
  const reducao_icms_al_dif = icms_atual - icms_al_dif;

  // Projeções (n operações iguais)
  const projections = {};
  for (const n of [1, 5, 10, 20]) {
    projections[n] = {
      custo_atual_total:   custo_atual   * n,
      custo_al_nf_total:   nf_al_nf      * n,
      custo_al_dif_total:  nf_al_dif     * n,
      economia_nf:         economia_vs_al_nf  * n,
      economia_dif:        economia_vs_al_dif * n,
      icms_atual_total:    icms_atual         * n,
      icms_al_nf_total:    icms_al_nf         * n,
      icms_al_dif_total:   icms_al_dif        * n,
      reducao_icms_dif:    reducao_icms_al_dif * n,
    };
  }

  return {
    inputs,
    breakdown: {
      vmld_usd,
      va_brl,
      ii: ii_valor,
      ipi: ipi_valor,
      pis: pis_valor,
      cofins: cof_valor,
      siscomex: inputs.siscomex,
      afrmm: inputs.afrmm,
      antidumping: inputs.antidumping,
      subtotal,
    },
    cenarios: {
      atual:    { aliq: icmsAliq,    icms: icms_atual,  custo_total: custo_atual },
      al_nf:    { aliq: ALIQ_AL_NF,  icms: icms_al_nf,  custo_total: nf_al_nf, economia: economia_vs_al_nf, reducao_icms: reducao_icms_al_nf },
      al_dif:   { aliq: ALIQ_AL_DIF, icms: icms_al_dif, custo_total: nf_al_dif, economia: economia_vs_al_dif, reducao_icms: reducao_icms_al_dif },
    },
    creditos: {
      al_nf:  icms_al_nf,
      al_dif: icms_al_dif,
    },
    projections,
    warnings,
    valid: warnings.length === 0,
  };
}
