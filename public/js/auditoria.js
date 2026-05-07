window.VIEW_auditoria = (() => {
  let page = 1;
  async function render() {
    const el = document.getElementById('view-auditoria');
    el.innerHTML = '<div class="muted">Carregando…</div>';
    await load();
  }
  async function load() {
    const el = document.getElementById('view-auditoria');
    try {
      const r = await API.get('/api/audit', { page, limit: 100 });
      el.innerHTML = UI.table({
        cols: [
          { label: 'Quando', get: x => UI.fmtDateTime(x.createdAt) },
          { label: 'Usuário', key: 'userName' },
          { label: 'Ação', key: 'action' },
          { label: 'Entidade', key: 'entity' },
          { label: 'ID', key: 'entityId' },
          { label: 'Detalhes', key: 'details' },
          { label: 'IP', key: 'ip' },
        ],
        rows: r.items, empty: 'Sem registros de auditoria.',
      }) + `<div style="margin-top:.75rem;display:flex;gap:.5rem;align-items:center">
        <span class="muted small">Página ${r.page} de ${r.pages} — ${r.total}</span>
        <button class="btn small" id="aud-prev" ${r.page<=1?'disabled':''}>‹</button>
        <button class="btn small" id="aud-next" ${r.page>=r.pages?'disabled':''}>›</button>
      </div>`;
      document.getElementById('aud-prev')?.addEventListener('click', () => { page--; load(); });
      document.getElementById('aud-next')?.addEventListener('click', () => { page++; load(); });
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }
  return { render };
})();
