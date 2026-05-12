// =====================================================================
// Consulta NCM — tributos federais, ICMS por UF e órgãos anuentes.
// Wrapper visual sobre o endpoint /api/ncm/:ncm?uf=XX que já existe e
// alimenta o cálculo da Solicitação de Créditos.
// =====================================================================
window['VIEW_consulta-ncm'] = (() => {
  const UFS = [
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
    'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
  ];

  // Última consulta em memória pra re-render com diferentes UFs sem nova chamada
  // se o NCM continuar o mesmo (cache simples).
  let last = { ncm: '', uf: '', data: null };

  async function render() {
    const el = document.getElementById('view-consulta-ncm');
    el.innerHTML = `
      <div class="panel">
        <h3 style="margin-top:0">Consulta NCM</h3>
        <p class="muted small">Informe um NCM (até 8 dígitos) para ver os tributos federais, alíquota do ICMS por UF e os órgãos anuentes obrigatórios para a importação.</p>

        <form id="cn-form" class="cn-form">
          <div class="cn-input-group">
            <label>NCM</label>
            <input id="cn-ncm" type="text" inputmode="numeric" maxlength="10" placeholder="Ex.: 8517.6259" autocomplete="off" />
          </div>
          <div class="cn-input-group" style="max-width:140px">
            <label>UF (ICMS)</label>
            <select id="cn-uf" data-no-combo>
              <option value="">—</option>
              ${UFS.map(u => `<option value="${u}">${u}</option>`).join('')}
            </select>
          </div>
          <button type="submit" class="btn primary" id="cn-go">🔍 Consultar</button>
          <button type="button" class="btn ghost" id="cn-clear">Limpar</button>
        </form>

        <div id="cn-result" style="margin-top:1rem"></div>
      </div>
    `;

    // Máscara NCM no input
    document.getElementById('cn-ncm').addEventListener('input', e => {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
      // formato 8517.6259
      e.target.value = digits.length > 4 ? `${digits.slice(0,4)}.${digits.slice(4)}` : digits;
    });

    document.getElementById('cn-form').addEventListener('submit', e => {
      e.preventDefault();
      consultar();
    });
    document.getElementById('cn-clear').addEventListener('click', () => {
      document.getElementById('cn-ncm').value = '';
      document.getElementById('cn-uf').value = '';
      document.getElementById('cn-uf').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('cn-result').innerHTML = '';
      last = { ncm: '', uf: '', data: null };
    });
    // Recalcula ICMS ao mudar UF (sem precisar clicar de novo)
    document.getElementById('cn-uf').addEventListener('change', () => {
      if (last.ncm) consultar();
    });
  }

  async function consultar() {
    const ncmInp = document.getElementById('cn-ncm');
    const ufInp  = document.getElementById('cn-uf');
    const out    = document.getElementById('cn-result');
    const ncm    = (ncmInp.value || '').replace(/\D/g, '');
    const uf     = ufInp.value || '';

    if (ncm.length < 2) {
      out.innerHTML = `<div class="err" style="padding:1rem;border-radius:8px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.4)">Informe ao menos 2 dígitos do NCM.</div>`;
      return;
    }

    out.innerHTML = `<div class="view-loader"><div class="boot-spinner"></div><div class="muted small">Consultando…</div></div>`;

    try {
      const params = uf ? { uf } : null;
      const data = await API.get(`/api/ncm/${ncm}`, params, { ttl: 60000 });
      last = { ncm, uf, data };
      out.innerHTML = renderResult(data);
    } catch (e) {
      out.innerHTML = `<div class="err" style="padding:1rem;border-radius:8px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.4)">${UI.escapeHtml(e.message)}</div>`;
    }
  }

  function pct(v) {
    if (v == null || isNaN(Number(v))) return '—';
    return Number(v).toFixed(2).replace('.', ',') + '%';
  }

  function fmtNcm(c) {
    if (!c) return '';
    if (c.length <= 4) return c;
    return c.slice(0, 4) + '.' + c.slice(4);
  }

  // Paleta de cores distintas pra anuentes. Mapeia órgãos conhecidos pra cores
  // estáveis (sempre o mesmo órgão fica com a mesma cor entre consultas), e usa
  // hash do nome pra ordens desconhecidas — assim a UI fica consistente sem ter
  // que manter uma tabela enorme.
  const ANUENTE_COLORS = {
    ANVISA:   { bg:'rgba(236,72,153,.15)', border:'#ec4899', text:'#ec4899' }, // rosa
    MAPA:     { bg:'rgba(34,197,94,.15)',  border:'#22c55e', text:'#22c55e' }, // verde
    IBAMA:    { bg:'rgba(132,204,22,.15)', border:'#84cc16', text:'#84cc16' }, // verde-lima
    ANATEL:   { bg:'rgba(59,130,246,.15)', border:'#3b82f6', text:'#3b82f6' }, // azul
    INMETRO:  { bg:'rgba(168,85,247,.15)', border:'#a855f7', text:'#a855f7' }, // roxo
    DNRC:     { bg:'rgba(20,184,166,.15)', border:'#14b8a6', text:'#14b8a6' }, // teal
    DPF:      { bg:'rgba(100,116,139,.15)',border:'#64748b', text:'#94a3b8' }, // cinza
    DECEX:    { bg:'rgba(249,115,22,.15)', border:'#f97316', text:'#f97316' }, // laranja
    DNPM:     { bg:'rgba(217,119,6,.15)',  border:'#d97706', text:'#d97706' }, // âmbar
    ANP:      { bg:'rgba(234,179,8,.15)',  border:'#eab308', text:'#eab308' }, // amarelo
    'COMANDO DO EXERCITO': { bg:'rgba(120,53,15,.2)',  border:'#92400e', text:'#a16207' },
    SUFRAMA:  { bg:'rgba(244,114,182,.15)',border:'#f472b6', text:'#f472b6' },
    DECEA:    { bg:'rgba(56,189,248,.15)', border:'#38bdf8', text:'#38bdf8' },
    MCTI:     { bg:'rgba(192,132,252,.15)',border:'#c084fc', text:'#c084fc' },
  };
  const PALETTE_FALLBACK = [
    { bg:'rgba(236,72,153,.15)', border:'#ec4899', text:'#ec4899' },
    { bg:'rgba(34,197,94,.15)',  border:'#22c55e', text:'#22c55e' },
    { bg:'rgba(59,130,246,.15)', border:'#3b82f6', text:'#3b82f6' },
    { bg:'rgba(168,85,247,.15)', border:'#a855f7', text:'#a855f7' },
    { bg:'rgba(249,115,22,.15)', border:'#f97316', text:'#f97316' },
    { bg:'rgba(20,184,166,.15)', border:'#14b8a6', text:'#14b8a6' },
    { bg:'rgba(234,179,8,.15)',  border:'#eab308', text:'#eab308' },
    { bg:'rgba(244,114,182,.15)',border:'#f472b6', text:'#f472b6' },
  ];
  function colorForAnuente(nome) {
    const key = String(nome || '').toUpperCase();
    if (ANUENTE_COLORS[key]) return ANUENTE_COLORS[key];
    // Hash simples (djb2-ish) pra picar uma cor estável da paleta fallback
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 33 + key.charCodeAt(i)) >>> 0;
    return PALETTE_FALLBACK[h % PALETTE_FALLBACK.length];
  }

  function matchBadge(level, tipo) {
    if (!level) return '<span class="cn-badge gray">não encontrado</span>';
    if (level === 8) return '<span class="cn-badge green">match exato (8 dígitos)</span>';
    return `<span class="cn-badge amber">${UI.escapeHtml(tipo)} — ${level} dígitos</span>`;
  }

  function renderResult(d) {
    const taxes = [
      { label: 'II',     value: d.ii_aliq,     color: 'blue',   hint: 'Imposto de Importação' },
      { label: 'IPI',    value: d.ipi_aliq,    color: 'purple', hint: 'Imposto sobre Produtos Industrializados' },
      { label: 'PIS',    value: d.pis_aliq,    color: 'teal',   hint: 'PIS/PASEP Importação' },
      { label: 'COFINS', value: d.cofins_aliq, color: 'orange', hint: 'COFINS Importação' },
    ];

    const icmsCard = `
      <div class="cn-icms-card">
        <div class="cn-icms-head">
          <span class="cn-icms-label">ICMS</span>
          ${d.uf ? `<span class="cn-badge dark">${UI.escapeHtml(d.uf)}</span>` : '<span class="muted small">selecione uma UF</span>'}
        </div>
        <div class="cn-icms-value">${d.uf ? pct(d.icms_aliq) : '—'}</div>
        ${d.uf && d.icms_observacoes ? `<div class="muted small" style="margin-top:.4rem">${UI.escapeHtml(d.icms_observacoes)}</div>` : ''}
      </div>`;

    const anuentesHtml = d.anuentes?.length
      ? `<div class="cn-anuentes-list">
          ${d.anuentes.map(a => {
            const c = colorForAnuente(a.anuente);
            const style = `background:${c.bg};border-left-color:${c.border}`;
            const tagStyle = `background:${c.bg};color:${c.text};border:1px solid ${c.border}`;
            return `
            <div class="cn-anuente ${a.obrigatorio ? 'obrig' : 'opcional'}" style="${style}">
              <div class="cn-anuente-head">
                <span class="cn-anuente-tag" style="${tagStyle}">${UI.escapeHtml(a.anuente)}</span>
                ${a.obrigatorio
                  ? '<span class="cn-badge red">obrigatório</span>'
                  : '<span class="cn-badge gray">condicional</span>'}
                <span class="muted small" style="margin-left:auto">match NCM: ${UI.escapeHtml(a.ncm_match || '—')}</span>
              </div>
              ${a.descricao ? `<div class="cn-anuente-desc">${UI.escapeHtml(a.descricao)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>`
      : `<div class="muted">Nenhum órgão anuente associado a este NCM. A importação não exige autorização prévia.</div>`;

    return `
      <div class="cn-result">
        <div class="cn-header-card">
          <div class="cn-ncm-display">
            <span class="muted small" style="text-transform:uppercase">NCM</span>
            <span class="cn-ncm-big">${fmtNcm(d.ncm)}</span>
          </div>
          <div class="cn-header-desc">
            ${d.descricao ? `<div class="cn-descricao">${UI.escapeHtml(d.descricao)}</div>` : '<div class="muted">Sem descrição cadastrada.</div>'}
            <div style="margin-top:.4rem">${matchBadge(d.matchLevel, d.matchTipo)}</div>
          </div>
        </div>

        <div class="cn-section-title">Tributos federais</div>
        <div class="cn-tax-grid">
          ${taxes.map(t => `
            <div class="cn-tax-card ${t.color}">
              <div class="cn-tax-label">${t.label}</div>
              <div class="cn-tax-value">${pct(t.value)}</div>
              <div class="cn-tax-hint">${t.hint}</div>
            </div>`).join('')}
          ${icmsCard}
        </div>

        <div class="cn-section-title" style="margin-top:1rem">Órgãos anuentes ${d.anuentes?.length ? `<span class="cn-badge dark">${d.anuentes.length}</span>` : ''}</div>
        ${anuentesHtml}

        ${!d.found ? `<div class="muted small" style="margin-top:1rem">⚠ Sem registro exato pra este NCM. As alíquotas mostradas (quando houver) vêm do match aproximado pelo capítulo/posição. Para valores 100% confiáveis, consulte a TEC oficial.</div>` : ''}
      </div>
    `;
  }

  return { render };
})();
