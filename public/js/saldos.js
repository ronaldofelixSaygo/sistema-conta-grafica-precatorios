window.VIEW_saldos = (() => {
  async function render() {
    const el = document.getElementById('view-saldos');
    el.innerHTML = '<div class="muted">Carregando…</div>';
    try {
      const rows = await API.get('/api/saldos');
      el.innerHTML = `
        <input id="sl-search" placeholder="Buscar cliente / escritório..." style="margin-bottom:.75rem;padding:7px 10px;background:var(--s2);border:1px solid var(--bd2);border-radius:8px;color:var(--t1);min-width:300px" />
        <div id="sl-table"></div>`;
      const draw = (filter='') => {
        const f = filter.toLowerCase();
        const list = rows.filter(r => !f
          || (r.nome||'').toLowerCase().includes(f)
          || (r.escritorio||'').toLowerCase().includes(f));
        document.getElementById('sl-table').innerHTML = UI.table({
          cols: [
            { label: 'Cliente', key: 'nome' },
            { label: 'Escritório', key: 'escritorio' },
            { label: 'Créditos', align: 'right', get: r => UI.fmtMoney(r.creditos) },
            { label: 'Débitos',  align: 'right', get: r => UI.fmtMoney(r.debitos) },
            { label: 'Transferências', align: 'right', get: r => UI.fmtMoney(r.transferencias) },
            { label: 'Saldo',    align: 'right', get: r => UI.fmtMoney(r.saldo) },
            { label: 'Média op.', align: 'right', get: r => UI.fmtMoney(r.media_operacao) },
            { label: 'Situação', html: true, get: r => {
              const c = r.situacao.includes('Urgente') ? 'var(--red)'
                       : r.situacao.includes('Alerta') ? 'var(--amber)' : 'var(--green)';
              return `<span style="color:${c};font-weight:700">${UI.escapeHtml(r.situacao)}</span>`;
            }},
          ],
          rows: list,
          empty: 'Sem saldos para mostrar.',
        });
      };
      draw();
      document.getElementById('sl-search').addEventListener('input', e => draw(e.target.value));
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }
  return { render };
})();
