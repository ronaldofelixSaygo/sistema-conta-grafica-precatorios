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

  // Estilo compacto dos inputs de filtro (inline pra não depender do CSS global)
  const INP = 'style="width:100%;box-sizing:border-box;font-size:12px;padding:3px 5px"';
  const THF = 'style="padding:3px 6px;background:var(--bg2,transparent)"';

  function render() {
    const el = document.getElementById('view-auditoria');
    el.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:.5rem">
        <button class="btn small ghost" id="af-clear">Limpar filtros</button>
      </div>
      <div style="overflow-x:auto">
        <table class="table" style="width:100%">
          <thead>
            <tr>
              <th>Quando</th><th>Usuário</th><th>Ação</th>
              <th>Entidade</th><th>ID</th><th>Detalhes</th><th>IP</th>
            </tr>
            <tr class="aud-filter-row">
              <th ${THF}>
                <div style="display:flex;flex-direction:column;gap:2px">
                  <input type="date" id="af-dataIni" title="De" ${INP}>
                  <input type="date" id="af-dataFim" title="Até" ${INP}>
                </div>
              </th>
              <th ${THF}><input id="af-userName" placeholder="filtrar…" ${INP}></th>
              <th ${THF}><input id="af-action"   placeholder="filtrar…" ${INP}></th>
              <th ${THF}><input id="af-entity"   placeholder="filtrar…" ${INP}></th>
              <th ${THF}><input id="af-entityId" placeholder="filtrar…" ${INP}></th>
              <th ${THF}><input id="af-details"  placeholder="filtrar…" ${INP}></th>
              <th ${THF}><input id="af-ip"       placeholder="filtrar…" ${INP}></th>
            </tr>
          </thead>
          <tbody id="aud-tbody">
            <tr><td colspan="7" class="muted small" style="padding:1rem">Carregando…</td></tr>
          </tbody>
        </table>
      </div>
      <div id="aud-pager"></div>`;
    bindFilters();
    load();
  }

  function bindFilters() {
    // Um timer de debounce por campo (pra não sobrescrever entre inputs)
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

  function rowsHtml(items) {
    if (!items || !items.length) {
      return '<tr><td colspan="7" class="muted small" style="padding:1rem">Nenhum registro para os filtros aplicados.</td></tr>';
    }
    return items.map(x => `<tr>
      <td>${UI.fmtDateTime(x.createdAt)}</td>
      <td>${UI.escapeHtml(x.userName)}</td>
      <td>${UI.escapeHtml(x.action)}</td>
      <td>${UI.escapeHtml(x.entity)}</td>
      <td>${UI.escapeHtml(x.entityId)}</td>
      <td>${UI.escapeHtml(x.details)}</td>
      <td>${UI.escapeHtml(x.ip)}</td>
    </tr>`).join('');
  }

  async function load() {
    const tbody = document.getElementById('aud-tbody');
    const pagerEl = document.getElementById('aud-pager');
    if (!tbody) return;
    try {
      // noStore: auditoria deve refletir o estado atual, sem cache.
      const r = await API.get('/api/audit', { page, limit: 100, ...filters }, { noStore: true });
      tbody.innerHTML = rowsHtml(r.items);
      pagerEl.innerHTML = `<div style="margin-top:.75rem;display:flex;gap:.5rem;align-items:center">
        <span class="muted small">Página ${r.page} de ${r.pages} — ${r.total} registro(s)</span>
        <button class="btn small" id="aud-prev" ${r.page<=1?'disabled':''}>‹</button>
        <button class="btn small" id="aud-next" ${r.page>=r.pages?'disabled':''}>›</button>
      </div>`;
      document.getElementById('aud-prev')?.addEventListener('click', () => { page--; load(); });
      document.getElementById('aud-next')?.addEventListener('click', () => { page++; load(); });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" class="err" style="padding:1rem">${UI.escapeHtml(e.message)}</td></tr>`;
    }
  }

  return { render };
})();
