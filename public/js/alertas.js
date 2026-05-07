window.VIEW_alertas = (() => {
  async function render() {
    const el = document.getElementById('view-alertas');
    el.innerHTML = '<div class="muted">Carregando…</div>';
    try {
      const rows = await API.get('/api/alertas');
      if (!rows.length) { el.innerHTML = '<div class="panel"><div class="muted">Sem alertas. ✓</div></div>'; return; }
      el.innerHTML = UI.table({
        cols: [
          { label: 'Nível', html: true, get: r => `<span style="color:${r.nivel==='urgente'?'var(--red)':'var(--amber)'};font-weight:700;text-transform:uppercase">${r.nivel}</span>` },
          { label: 'Cliente',    key: 'cliente_nome' },
          { label: 'Escritório', key: 'escritorio' },
          { label: 'Saldo', align: 'right', get: r => UI.fmtMoney(r.saldo) },
          { label: 'Mensagem',   key: 'msg' },
        ], rows,
      });
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }
  return { render };
})();
