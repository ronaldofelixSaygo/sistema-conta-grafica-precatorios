window.VIEW_auditoria = (() => {
  let page = 1;
  // Filtros por coluna (enviados ao backend). Mantidos em memória durante a sessão.
  let filters = {};

  // Campos de texto: id do input -> chave enviada ao backend
  const TEXT_FIELDS = {
    'af-userName': 'userName',
    'af-action':   'action',
    'af-entity':   'entity',
    'af-entityId': 'entityId',
    'af-details':  'details',
    'af-ip':       'ip',
  };

  function render() {
    const el = document.getElementById('view-auditoria');
    el.innerHTML = `
      <div class="aud-filters">
        <div class="aud-f"><label class="muted small">Quando — de</label><input id="af-dataIni" type="date"></div>
        <div class="aud-f"><label class="muted small">Quando — até</label><input id="af-dataFim" type="date"></div>
        <div class="aud-f"><label class="muted small">Usuário</label><input id="af-userName" placeholder="filtrar…"></div>
        <div class="aud-f"><label class="muted small">Ação</label><input id="af-action" placeholder="filtrar…"></div>
        <div class="aud-f"><label class="muted small">Entidade</label><input id="af-entity" placeholder="filtrar…"></div>
        <div class="aud-f"><label class="muted small">ID</label><input id="af-entityId" placeholder="filtrar…"></div>
        <div class="aud-f"><label class="muted small">Detalhes</label><input id="af-details" placeholder="filtrar…"></div>
        <div class="aud-f"><label class="muted small">IP</label><input id="af-ip" placeholder="filtrar…"></div>
        <button class="btn small ghost" id="af-clear" style="align-self:flex-end">Limpar filtros</button>
      </div>
      <div id="aud-table"><div class="muted">Carregando…</div></div>
      <div id="aud-pager"></div>`;
    bindFilters();
    load();
  }

  function bindFilters() {
    // Um timer de debounce por input (pra não sobrescrever entre campos)
    const timers = {};
    Object.entries(TEXT_FIELDS).forEach(([id, key]) => {
      const inp = document.getElementById(id);
      if (!inp) return;
      inp.value = filters[key] || '';
      inp.addEventListener('input', e => {
        clearTimeout(timers[key]);
        const v = e.target.value.trim();
        timers[key] = setTimeout(() => setFilter(key, v), 300);
      });
    });
    ['dataIni', 'dataFim'].forEach(key => {
      const inp = document.getElementById('af-' + key);
      if (!inp) return;
      inp.value = filters[key] || '';
      inp.addEventListener('change', e => setFilter(key, e.target.value));
    });
    document.getElementById('af-clear')?.addEventListener('click', () => {
      filters = {};
      Object.keys(TEXT_FIELDS).concat(['af-dataIni', 'af-dataFim']).forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      page = 1; load();
    });
  }

  function setFilter(key, val) {
    if (val === '' || val == null) delete filters[key];
    else filters[key] = val;
    page = 1;      // qualquer mudança de filtro volta pra primeira página
    load();
  }

  async function load() {
    const tableEl = document.getElementById('aud-table');
    const pagerEl = document.getElementById('aud-pager');
    if (!tableEl) return;
    try {
      // noStore: auditoria deve refletir o estado atual, sem cache.
      const r = await API.get('/api/audit', { page, limit: 100, ...filters }, { noStore: true });
      tableEl.innerHTML = UI.table({
        cols: [
          { label: 'Quando', get: x => UI.fmtDateTime(x.createdAt) },
          { label: 'Usuário', key: 'userName' },
          { label: 'Ação', key: 'action' },
          { label: 'Entidade', key: 'entity' },
          { label: 'ID', key: 'entityId' },
          { label: 'Detalhes', key: 'details' },
          { label: 'IP', key: 'ip' },
        ],
        rows: r.items, empty: 'Nenhum registro para os filtros aplicados.',
      });
      pagerEl.innerHTML = `<div style="margin-top:.75rem;display:flex;gap:.5rem;align-items:center">
        <span class="muted small">Página ${r.page} de ${r.pages} — ${r.total} registro(s)</span>
        <button class="btn small" id="aud-prev" ${r.page<=1?'disabled':''}>‹</button>
        <button class="btn small" id="aud-next" ${r.page>=r.pages?'disabled':''}>›</button>
      </div>`;
      document.getElementById('aud-prev')?.addEventListener('click', () => { page--; load(); });
      document.getElementById('aud-next')?.addEventListener('click', () => { page++; load(); });
    } catch (e) { tableEl.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  return { render };
})();
