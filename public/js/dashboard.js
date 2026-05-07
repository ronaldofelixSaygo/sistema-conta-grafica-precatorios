window.VIEW_dashboard = (() => {
  async function render() {
    const el = document.getElementById('view-dashboard');
    el.innerHTML = '<div class="muted">Carregando…</div>';
    try {
      const d = await API.get('/api/dashboard');
      const t = d.totals || {};
      el.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="l">Clientes</div><div class="v">${UI.fmtNum(t.clientes)}</div></div>
          <div class="kpi b"><div class="l">Movimentações</div><div class="v">${UI.fmtNum(t.movimentacoes)}</div></div>
          <div class="kpi"><div class="l">Créditos</div><div class="v">${UI.fmtMoney(t.creditos)}</div></div>
          <div class="kpi r"><div class="l">Débitos</div><div class="v">${UI.fmtMoney(t.debitos)}</div></div>
          <div class="kpi p"><div class="l">Saldo</div><div class="v">${UI.fmtMoney(t.saldo)}</div></div>
          ${AUTH.isAdm() ? `<div class="kpi a"><div class="l">Usuários</div><div class="v">${UI.fmtNum(t.users)}</div></div>` : ''}
        </div>
        <div class="panel">
          <h3>Últimas movimentações</h3>
          ${UI.table({
            cols: [
              { label: 'Cliente', key: 'cliente_nome' },
              { label: 'Tipo',    key: 'tipo_movimento' },
              { label: 'Data',    get: r => UI.fmtDate(r.data_nf || r.created_at) },
              { label: 'Valor',   align: 'right', get: r => UI.fmtMoney(r.valor_ajustado) },
            ],
            rows: d.ultimas || [],
            empty: 'Sem movimentações ainda.',
          })}
        </div>`;
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }
  return { render };
})();
