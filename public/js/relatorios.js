window.VIEW_relatorios = (() => {
  let clientesCache = [];
  const TIPOS = [
    'Créditos Reconhecidos e Cedidos',
    'Débitos de Liquidações',
    'Débitos de Transferências',
  ];

  async function render() {
    const el = document.getElementById('view-relatorios');
    if (!clientesCache.length) {
      try { clientesCache = await API.get('/api/clientes'); } catch {}
    }
    const cliOpts = clientesCache.map(c =>
      `<option value="${c.id}">${UI.escapeHtml(c.nome)}${c.escritorio?` — ${UI.escapeHtml(c.escritorio)}`:''}</option>`).join('');
    const tipoOpts = TIPOS.map(t => `<option value="${UI.escapeHtml(t)}">${UI.escapeHtml(t)}</option>`).join('');
    el.innerHTML = `
      <div class="page-toolbar">
        <select id="rl-cli" style="min-width:280px">
          <option value="">Todos os clientes</option>${cliOpts}
        </select>
        <select id="rl-tipo">
          <option value="">Todos os tipos</option>${tipoOpts}
        </select>
        <input id="rl-ini" type="date" />
        <input id="rl-fim" type="date" />
        <button class="btn" id="rl-prev">Pré-visualizar</button>
        <button class="btn" id="rl-clear">Limpar</button>
        <span style="flex:1"></span>
        <button class="btn primary" id="rl-xls">Exportar Excel</button>
        <button class="btn" id="rl-pdf">Exportar PDF</button>
      </div>
      <div id="rl-out"></div>`;
    document.getElementById('rl-prev').onclick = preview;
    document.getElementById('rl-xls').onclick  = () => download('excel');
    document.getElementById('rl-pdf').onclick  = () => download('pdf');
    document.getElementById('rl-clear').onclick = () => {
      ['rl-cli','rl-tipo','rl-ini','rl-fim'].forEach(id => document.getElementById(id).value='');
      document.getElementById('rl-out').innerHTML = '';
    };
  }

  function params() {
    return {
      cliente_id: v('rl-cli'),
      f_tipo:     v('rl-tipo'),
      f_data_ini: v('rl-ini'),
      f_data_fim: v('rl-fim'),
    };
  }
  const v = id => document.getElementById(id)?.value || '';

  async function preview() {
    document.getElementById('rl-out').innerHTML = '<div class="muted">Carregando...</div>';
    try {
      const rows = await API.get('/api/relatorio', params());
      document.getElementById('rl-out').innerHTML = `
        <div class="muted small" style="margin-bottom:.4rem">${rows.length} lançamento(s)</div>
        ${UI.table({
          cols: [
            { label: 'Cliente', key: 'cliente_nome' },
            { label: 'Escritório', key: 'escritorio' },
            { label: 'Tipo Movimento', html: true, get: r => {
              const cls = (r.tipo_movimento||'').includes('Débito') ? 'red' : 'green';
              return `<span class="pill ${cls}">${UI.escapeHtml(r.tipo_movimento||'')}</span>`;
            }},
            { label: 'Data NF', get: r => UI.fmtDate(r.data_nf) },
            { label: 'DUIMP/DI/Proc.', key: 'duimp_di_processo' },
            { label: 'Interveniente', key: 'parceiro' },
            { label: '%', align: 'right', get: r => (r.percentual ?? 0) + '%' },
            { label: 'Valor', align: 'right', get: r => UI.fmtMoney(r.valor) },
            { label: 'Ajustado', align: 'right', html: true, get: r =>
              `<span class="${r.valor_ajustado<0?'val-neg':'val-pos'}">${UI.fmtMoney(r.valor_ajustado)}</span>` },
          ],
          rows, empty: 'Sem dados para o filtro.',
        })}`;
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
