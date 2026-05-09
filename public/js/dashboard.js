window.VIEW_dashboard = (() => {
  let clientesCache = [];

  async function render() {
    const el = document.getElementById('view-dashboard');
    el.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      if (!clientesCache.length) {
        try { clientesCache = await API.get('/api/clientes', null, { ttl: 60000 }); } catch {}
      }
      const cliOpts = clientesCache.map(c =>
        `<option value="${c.id}">${UI.escapeHtml(c.nome)}</option>`).join('');
      el.innerHTML = `
        <div class="page-toolbar">
          <select id="d-cli">
            <option value="">Todos os clientes</option>${cliOpts}
          </select>
          <input id="d-ini" type="date" />
          <input id="d-fim" type="date" />
          <button class="btn" id="d-apply">Aplicar</button>
          <button class="btn" id="d-clear">Limpar</button>
        </div>
        <div id="d-kpis"></div>
        <div class="panel">
          <h3>Últimas movimentações</h3>
          <div id="d-table"></div>
        </div>`;
      document.getElementById('d-apply').onclick = load;
      document.getElementById('d-clear').onclick = () => {
        document.getElementById('d-cli').value = '';
        document.getElementById('d-ini').value = '';
        document.getElementById('d-fim').value = '';
        load();
      };
      load();
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  async function load() {
    const q = {
      cliente_id: document.getElementById('d-cli')?.value || '',
      data_ini:   document.getElementById('d-ini')?.value || '',
      data_fim:   document.getElementById('d-fim')?.value || '',
    };
    try {
      const d = await API.get('/api/dashboard', q);
      const t = d.totals || {};
      document.getElementById('d-kpis').innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="l">Clientes</div><div class="v">${UI.fmtNum(t.clientes)}</div></div>
          <div class="kpi b"><div class="l">Movimentações</div><div class="v">${UI.fmtNum(t.movimentacoes)}</div></div>
          <div class="kpi g"><div class="l">Créditos</div><div class="v val-pos">${UI.fmtMoney(t.creditos)}</div></div>
          <div class="kpi r"><div class="l">Débitos</div><div class="v val-neg">${UI.fmtMoney(t.debitos)}</div></div>
          <div class="kpi p"><div class="l">Saldo</div><div class="v">${UI.fmtMoney(t.saldo)}</div></div>
          ${AUTH.isAdm() ? `<div class="kpi a"><div class="l">Usuários</div><div class="v">${UI.fmtNum(t.users)}</div></div>` : ''}
        </div>`;
      document.getElementById('d-table').innerHTML = UI.table({
        cols: [
          { label: 'Cliente', key: 'cliente_nome' },
          { label: 'Escritório', key: 'escritorio' },
          { label: 'Tipo',    html: true, get: r => {
            const cls = (r.tipo_movimento||'').includes('Débito')?'red':'green';
            return `<span class="pill ${cls}">${UI.escapeHtml(r.tipo_movimento||'')}</span>`;
          }},
          { label: 'Data',    get: r => UI.fmtDate(r.data_nf || r.created_at) },
          { label: 'Valor',   align: 'right', html: true, get: r => {
            const v = r.valor_ajustado;
            return `<span class="${v<0?'val-neg':'val-pos'}">${UI.fmtMoney(v)}</span>`;
          }},
        ],
        rows: d.ultimas || [],
        empty: 'Sem movimentações no período.',
      });
    } catch (e) {
      document.getElementById('d-kpis').innerHTML = `<div class="err">${e.message}</div>`;
    }
  }

  return { render };
})();
