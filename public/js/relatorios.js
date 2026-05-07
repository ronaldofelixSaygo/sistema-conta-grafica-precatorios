window.VIEW_relatorios = (() => {
  async function render() {
    const el = document.getElementById('view-relatorios');
    el.innerHTML = `
      <div class="filters">
        <input id="rl-tipo" placeholder="Tipo (contém)" />
        <input id="rl-parc" placeholder="Parceiro (contém)" />
        <input id="rl-ini" type="date" /> <input id="rl-fim" type="date" />
        <button class="btn" id="rl-prev">Pré-visualizar</button>
        <button class="btn primary" id="rl-xls">Exportar Excel</button>
        <button class="btn" id="rl-pdf">Exportar PDF</button>
      </div>
      <div id="rl-out"></div>`;
    document.getElementById('rl-prev').onclick = preview;
    document.getElementById('rl-xls').onclick  = () => download('excel');
    document.getElementById('rl-pdf').onclick  = () => download('pdf');
  }
  function params() {
    return {
      f_tipo: v('rl-tipo'), f_parceiro: v('rl-parc'),
      f_data_ini: v('rl-ini'), f_data_fim: v('rl-fim'),
    };
  }
  const v = id => document.getElementById(id)?.value || '';
  async function preview() {
    document.getElementById('rl-out').innerHTML = '<div class="muted">Carregando…</div>';
    try {
      const rows = await API.get('/api/relatorio', params());
      document.getElementById('rl-out').innerHTML = UI.table({
        cols: [
          { label: 'Cliente', key: 'cliente_nome' },
          { label: 'Escritório', key: 'escritorio' },
          { label: 'Tipo',    key: 'tipo_movimento' },
          { label: 'Data',    get: r => UI.fmtDate(r.data_nf) },
          { label: 'DUIMP',   key: 'duimp_di_processo' },
          { label: 'Parceiro', key: 'parceiro' },
          { label: '%', align: 'right', key: 'percentual' },
          { label: 'Valor', align: 'right', get: r => UI.fmtMoney(r.valor) },
          { label: 'Ajustado', align: 'right', get: r => UI.fmtMoney(r.valor_ajustado) },
        ],
        rows, empty: 'Sem dados para o filtro.',
      });
    } catch (e) {
      document.getElementById('rl-out').innerHTML = `<div class="err">${e.message}</div>`;
    }
  }
  function download(kind) {
    const url = (kind==='excel' ? '/api/relatorio/excel' : '/api/relatorio/pdf') + API.qs(params());
    window.open(url, '_blank');
  }
  return { render };
})();
