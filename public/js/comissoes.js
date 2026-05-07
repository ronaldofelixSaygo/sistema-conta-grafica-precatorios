window.VIEW_comissoes = (() => {
  async function render() {
    const el = document.getElementById('view-comissoes');
    el.innerHTML = `
      <div class="filters">
        <input id="co-parceiro" placeholder="Parceiro" />
        <input id="co-mes" placeholder="MM" maxlength="2" style="max-width:80px" />
        <input id="co-ano" placeholder="AAAA" maxlength="4" style="max-width:100px" />
        <button class="btn" id="co-apply">Filtrar</button>
      </div>
      <div id="co-list"></div>`;
    document.getElementById('co-apply').onclick = load;
    load();
  }
  async function load() {
    const q = {
      parceiro: val('co-parceiro'),
      mes: val('co-mes'),
      ano: val('co-ano'),
    };
    try {
      const rows = await API.get('/api/comissoes', q);
      if (!rows.length) {
        document.getElementById('co-list').innerHTML = '<div class="muted small" style="padding:1rem">Sem comissões no período.</div>';
        return;
      }
      document.getElementById('co-list').innerHTML = rows.map(r => `
        <div class="panel">
          <h3>${UI.escapeHtml(r.parceiro)} — ${UI.escapeHtml(r.mes_ano)}
            <span style="float:right;color:var(--green)">${UI.fmtMoney(r.total_comissao)}</span></h3>
          ${UI.table({
            cols: [
              { label: 'Cliente', key: 'cliente_nome' },
              { label: 'Período', get: x => `${UI.fmtDate(x.periodo_inicio)} → ${UI.fmtDate(x.periodo_fim)}` },
              { label: 'Créditos', align: 'right', get: x => UI.fmtMoney(x.total_creditos) },
              { label: '%', align: 'right', get: x => `${x.percentual}%` },
              { label: 'Comissão', align: 'right', get: x => UI.fmtMoney(x.valor_comissao) },
            ],
            rows: r.detalhes,
          })}
        </div>`).join('');
    } catch (e) {
      document.getElementById('co-list').innerHTML = `<div class="err">${e.message}</div>`;
    }
  }
  const val = id => document.getElementById(id)?.value || '';
  return { render };
})();
