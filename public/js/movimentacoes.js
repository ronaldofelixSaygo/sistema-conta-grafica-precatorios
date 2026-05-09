window.VIEW_movimentacoes = (() => {
  let page = 1;
  const TIPOS = [
    'Créditos Reconhecidos e Cedidos',
    'Débitos de Liquidações',
    'Débitos de Transferências',
  ];
  let clientesCache = [];
  let escritoriosCache = null;

  async function loadEscritorios() {
    if (escritoriosCache) return escritoriosCache;
    try {
      const list = await API.get('/api/comissoes/escritorios', null, { ttl: 60000 });
      escritoriosCache = (list || []).filter(Boolean);
    } catch { escritoriosCache = []; }
    return escritoriosCache;
  }

  function tipoPill(t) {
    if (!t) return '';
    const cls = t.includes('Débito') ? 'red' : 'green';
    return `<span class="pill ${cls}">${UI.escapeHtml(t)}</span>`;
  }

  async function render() {
    const el = document.getElementById('view-movimentacoes');
    const canMutate = AUTH.canMutate('movimentacoes');
    const isStaff = AUTH.isStaff();

    if (!clientesCache.length) {
      try { clientesCache = await API.get('/api/clientes', null, { ttl: 60000 }); } catch {}
    }
    const escs = isStaff ? await loadEscritorios() : [];
    const cliFilterOpts = clientesCache.map(c =>
      `<option value="${c.id}">${UI.escapeHtml(c.nome)}${c.escritorio?` — ${UI.escapeHtml(c.escritorio)}`:''}</option>`).join('');
    const escOpts = escs.map(e =>
      `<option value="${UI.escapeHtml(e)}">${UI.escapeHtml(e)}</option>`).join('');

    el.innerHTML = `
      <div class="page-toolbar">
        <input id="m-search"   placeholder="Buscar (cliente / DUIMP)" />
        <select id="m-cliente"><option value="">Todos os clientes</option>${cliFilterOpts}</select>
        <select id="m-tipo"><option value="">Todos os tipos</option>${TIPOS.map(t => `<option>${t}</option>`).join('')}</select>
        ${isStaff ? `<select id="m-parceiro"><option value="">Todos os parceiros</option>${escOpts}</select>` : ''}
        <input id="m-ini" type="date" /> <input id="m-fim" type="date" />
        <input id="m-vmin" type="number" step="0.01" placeholder="Valor mín" />
        <input id="m-vmax" type="number" step="0.01" placeholder="Valor máx" />
        <button class="btn" id="m-apply">Filtrar</button>
        <button class="btn" id="m-clear">Limpar</button>
        ${canMutate ? `
          <span style="flex:1"></span>
          <button class="btn" id="m-import">Importar Extrato PDF</button>
          <button class="btn primary" id="m-new">+ Novo Lançamento</button>
        ` : ''}
      </div>
      <div id="m-table"></div>
      <div id="m-pager" style="margin-top:.75rem;display:flex;gap:.5rem;align-items:center"></div>`;

    const apply = () => { page = 1; load(); };
    document.getElementById('m-apply').onclick = apply;
    document.getElementById('m-clear').onclick = () => {
      ['m-search','m-cliente','m-parceiro','m-ini','m-fim','m-vmin','m-vmax'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      document.getElementById('m-tipo').value = '';
      apply();
    };
    el.querySelectorAll('input,select').forEach(i => i.addEventListener('keydown', e => { if (e.key==='Enter') apply(); }));

    if (canMutate) {
      document.getElementById('m-new').onclick = () => openForm();
      document.getElementById('m-import').onclick = openImport;
    }
    load();
  }

  async function load() {
    const q = {
      search: val('m-search'),
      cliente_id: val('m-cliente'),
      f_tipo: val('m-tipo'),
      f_parceiro: val('m-parceiro'),
      f_data_ini: val('m-ini'), f_data_fim: val('m-fim'),
      f_valor_min: val('m-vmin'), f_valor_max: val('m-vmax'),
      page, limit: 50,
    };
    try {
      const r = await API.get('/api/movimentacoes', q);
      const canMutate = AUTH.canMutate('movimentacoes');
      document.getElementById('m-table').innerHTML = UI.table({
        cols: [
          { label: 'Cliente', key: 'cliente_nome' },
          { label: 'Tipo Movimento', html: true, get: r => tipoPill(r.tipo_movimento) },
          { label: 'Data NF', get: r => UI.fmtDate(r.data_nf) },
          { label: 'DUIMP/DI/Proc.', key: 'duimp_di_processo' },
          { label: 'Interveniente', key: 'parceiro' },
          { label: '%', align: 'right', get: r => (r.percentual ?? 0) + '%' },
          { label: 'Valor', align: 'right', html: true, get: r => {
            const v = r.valor_ajustado;
            const cls = v < 0 ? 'val-neg' : 'val-pos';
            return `<span class="${cls}">${UI.fmtMoney(v)}</span>`;
          }},
          { label: 'Ações', html: true, get: r => canMutate
            ? `<div class="actions"><button class="btn small" data-edit="${r.id}">Editar</button>
                <button class="btn small danger" data-del="${r.id}">Excluir</button></div>` : '',
          },
        ],
        rows: r.items, empty: 'Sem lançamentos.',
      });

      document.getElementById('m-pager').innerHTML =
        `<span class="muted small">Página ${r.page} de ${r.pages} — ${r.total} lançamentos</span>
         <button class="btn small" id="pg-prev" ${r.page<=1?'disabled':''}>‹</button>
         <button class="btn small" id="pg-next" ${r.page>=r.pages?'disabled':''}>›</button>`;
      document.getElementById('pg-prev')?.addEventListener('click', () => { page--; load(); });
      document.getElementById('pg-next')?.addEventListener('click', () => { page++; load(); });

      const tbl = document.getElementById('m-table');
      tbl.addEventListener('click', e => {
        const eid = e.target.getAttribute('data-edit');
        const did = e.target.getAttribute('data-del');
        if (eid) {
          const row = r.items.find(x => String(x.id)===eid);
          openForm(row);
        }
        if (did) removeMov(did);
      });
    } catch (e) {
      document.getElementById('m-table').innerHTML = `<div class="err">${e.message}</div>`;
    }
  }
  const val = id => document.getElementById(id)?.value || '';

  function openForm(m = {}) {
    const opts = clientesCache.map(c =>
      `<option value="${c.id}" ${m.cliente_id===c.id?'selected':''}>${UI.escapeHtml(c.nome)}${c.escritorio?` — ${UI.escapeHtml(c.escritorio)}`:''}</option>`).join('');
    UI.openModal(m.id ? `Editar lançamento #${m.id}` : 'Novo lançamento', `
      <form id="form-mov" class="form-grid">
        <div class="full"><label>Cliente *</label><select name="cliente_id" required><option value="">—</option>${opts}</select></div>
        <div><label>Tipo *</label><select name="tipo_movimento" required>${TIPOS.map(t => `<option ${m.tipo_movimento===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div><label>Data NF</label><input type="date" name="data_nf" value="${(m.data_nf||'').toString().slice(0,10)}"></div>
        <div><label>DUIMP / DI / Processo</label><input name="duimp_di_processo" value="${UI.escapeHtml(m.duimp_di_processo||'')}"></div>
        <div><label>Data exoneração</label><input type="date" name="data_exoneracao" value="${(m.data_exoneracao||'').toString().slice(0,10)}"></div>
        <div><label>%</label><input type="number" step="0.01" name="percentual" value="${m.percentual ?? 0}"></div>
        <div><label>Valor</label><input type="number" step="0.01" name="valor" required value="${m.valor ?? 0}"></div>
        <div class="full form-actions">
          <button type="button" class="btn" id="mov-cancel">Cancelar</button>
          <button class="btn primary" type="submit">Salvar</button>
        </div>
      </form>`);
    document.getElementById('mov-cancel').onclick = UI.closeModal;
    document.getElementById('form-mov').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const data = Object.fromEntries(fd.entries());
      try {
        if (m.id) await API.put(`/api/movimentacoes/${m.id}`, data);
        else      await API.post('/api/movimentacoes', data);
        UI.toast('Lançamento salvo'); UI.closeModal(); load();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  async function removeMov(id) {
    if (!confirm('Excluir este lançamento?')) return;
    try { await API.del(`/api/movimentacoes/${id}`); UI.toast('Excluído'); load(); }
    catch (e) { UI.toast(e.message, 'err'); }
  }

  // ---- Importar Extrato PDF ----
  function openImport() {
    const opts = clientesCache.map(c =>
      `<option value="${c.id}">${UI.escapeHtml(c.nome)}${c.escritorio?` — ${UI.escapeHtml(c.escritorio)}`:''}</option>`).join('');
    UI.openModal('Importar Extrato PDF', `
      <div class="form-grid">
        <div class="full">
          <label>Cliente alvo (será usado para todos os lançamentos detectados) *</label>
          <select id="imp-cli"><option value="">—</option>${opts}</select>
        </div>
        <div class="full">
          <label>Arquivo PDF *</label>
          <input type="file" id="imp-file" accept="application/pdf">
        </div>
        <div class="full">
          <button class="btn primary" id="imp-prev">Pré-visualizar lançamentos</button>
        </div>
        <div class="full" id="imp-out"></div>
      </div>`);
    document.getElementById('imp-prev').onclick = previewImport;
  }
  let lastPreview = null;
  async function previewImport() {
    const cli  = document.getElementById('imp-cli').value;
    const file = document.getElementById('imp-file').files[0];
    if (!file) { UI.toast('Selecione um PDF', 'err'); return; }
    if (!cli)  { UI.toast('Selecione um cliente alvo', 'err'); return; }
    const fd = new FormData(); fd.append('file', file);
    document.getElementById('imp-out').innerHTML = '<div class="muted">Lendo PDF...</div>';
    try {
      const r = await fetch('/api/movimentacoes/import-extrato/preview', {
        method: 'POST', credentials: 'include', body: fd,
      });
      if (!r.ok) throw new Error('Falha ao ler PDF');
      const j = await r.json();
      lastPreview = j;
      const rows = (j.items || []).map((it, idx) => `
        <tr>
          <td>${UI.fmtDate(it.data_nf)}</td>
          <td>${UI.escapeHtml(it.duimp_di_processo || '')}</td>
          <td>${UI.escapeHtml(it.tipo_movimento)}</td>
          <td class="num">${UI.fmtMoney(it.valor)}</td>
          <td><input type="checkbox" data-imp-i="${idx}" checked></td>
        </tr>`).join('');
      document.getElementById('imp-out').innerHTML = `
        <div class="muted small" style="margin-bottom:.5rem">${j.count} lançamento(s) detectado(s).</div>
        <table class="table"><thead>
          <tr><th>Data</th><th>DUIMP</th><th>Tipo</th><th>Valor</th><th>Importar?</th></tr>
        </thead><tbody>${rows}</tbody></table>
        <div class="form-actions" style="margin-top:.6rem">
          <button class="btn primary" id="imp-apply">Aplicar selecionados</button>
        </div>`;
      document.getElementById('imp-apply').onclick = applyImport;
    } catch (e) {
      document.getElementById('imp-out').innerHTML = `<div class="err">${e.message}</div>`;
    }
  }
  async function applyImport() {
    const cliId = document.getElementById('imp-cli').value;
    const checks = document.querySelectorAll('[data-imp-i]');
    const items = [];
    checks.forEach(c => {
      if (c.checked) items.push({ ...lastPreview.items[Number(c.dataset.impI)], cliente_id: Number(cliId) });
    });
    if (!items.length) return UI.toast('Nada selecionado', 'err');
    try {
      const r = await API.post('/api/movimentacoes/import-extrato/apply', { items, cliente_id: Number(cliId) });
      UI.toast(`${r.created} lançamentos criados`);
      UI.closeModal(); load();
    } catch (e) { UI.toast(e.message, 'err'); }
  }

  return { render };
})();
