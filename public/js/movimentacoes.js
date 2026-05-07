window.VIEW_movimentacoes = (() => {
  let page = 1;
  const TIPOS = [
    'Créditos Reconhecidos e Cedidos',
    'Débitos de Liquidações',
    'Débitos de Transferências',
  ];
  let clientesCache = [];

  async function render() {
    const el = document.getElementById('view-movimentacoes');
    const canMutate = AUTH.isStaff();
    el.innerHTML = `
      <div class="filters">
        <input id="m-search"   placeholder="Buscar (cliente / DUIMP)" />
        <input id="m-cliente"  placeholder="Cliente"   />
        <select id="m-tipo"><option value="">Todos os tipos</option>${TIPOS.map(t => `<option>${t}</option>`).join('')}</select>
        <input id="m-parceiro" placeholder="Parceiro"  />
        <input id="m-ini" type="date" /> <input id="m-fim" type="date" />
        <button class="btn" id="m-apply">Filtrar</button>
        ${canMutate ? '<button class="btn primary" id="m-new">+ Lançamento</button>' : ''}
      </div>
      <div id="m-table"></div>
      <div id="m-pager" style="margin-top:.75rem;display:flex;gap:.5rem;align-items:center"></div>`;

    if (!clientesCache.length) {
      try { clientesCache = await API.get('/api/clientes'); } catch {}
    }

    const apply = () => { page = 1; load(); };
    document.getElementById('m-apply').onclick = apply;
    el.querySelectorAll('input,select').forEach(i => i.addEventListener('keydown', e => { if (e.key==='Enter') apply(); }));
    if (canMutate) document.getElementById('m-new').onclick = () => openForm();

    load();
  }

  async function load() {
    const q = {
      search: val('m-search'), f_cliente: val('m-cliente'), f_tipo: val('m-tipo'),
      f_parceiro: val('m-parceiro'), f_data_ini: val('m-ini'), f_data_fim: val('m-fim'),
      page, limit: 50,
    };
    try {
      const r = await API.get('/api/movimentacoes', q);
      const canMutate = AUTH.isStaff();
      document.getElementById('m-table').innerHTML = UI.table({
        cols: [
          { label: 'Cliente', key: 'cliente_nome' },
          { label: 'Tipo',    key: 'tipo_movimento' },
          { label: 'Data',    get: r => UI.fmtDate(r.data_nf) },
          { label: 'DUIMP/DI/Proc.', key: 'duimp_di_processo' },
          { label: 'Parceiro', key: 'parceiro' },
          { label: 'Valor',   align: 'right', get: r => UI.fmtMoney(r.valor_ajustado) },
          { label: '', html: true, get: r => canMutate
            ? `<div class="actions"><button class="btn small" data-edit="${r.id}">✎</button>
                <button class="btn small danger" data-del="${r.id}">×</button></div>` : '',
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

  return { render };
})();
