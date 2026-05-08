window.VIEW_saldos = (() => {
  function situacaoPill(s) {
    if (!s) return '';
    if (s.includes('Urgente')) return `<span class="pill red">${UI.escapeHtml(s)}</span>`;
    if (s.includes('Alerta'))  return `<span class="pill amber">${UI.escapeHtml(s)}</span>`;
    return `<span class="pill green">${UI.escapeHtml(s)}</span>`;
  }
  async function render() {
    const el = document.getElementById('view-saldos');
    el.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      const rows = await API.get('/api/saldos');
      const escritorios = [...new Set(rows.map(r => r.escritorio).filter(Boolean))].sort();
      el.innerHTML = `
        <div class="page-toolbar">
          <input id="sl-search" placeholder="Buscar cliente..." />
          <select id="sl-esc">
            <option value="">Todos os escritórios</option>
            ${escritorios.map(e => `<option value="${UI.escapeHtml(e)}">${UI.escapeHtml(e)}</option>`).join('')}
          </select>
          <select id="sl-sit">
            <option value="">Todas as situações</option>
            <option value="Normal">Normal</option>
            <option value="Alerta">Alerta</option>
            <option value="Urgente">Urgente</option>
          </select>
        </div>
        <div class="panel">
          <h3>Situação dos Saldos</h3>
          <div id="sl-table"></div>
        </div>`;
      const draw = () => {
        const f = (document.getElementById('sl-search')?.value || '').toLowerCase();
        const esc = document.getElementById('sl-esc')?.value || '';
        const sit = document.getElementById('sl-sit')?.value || '';
        const list = rows.filter(r => {
          if (esc && r.escritorio !== esc) return false;
          if (sit && !(r.situacao||'').includes(sit)) return false;
          if (!f) return true;
          return (r.nome||'').toLowerCase().includes(f);
        });
        document.getElementById('sl-table').innerHTML = UI.table({
          cols: [
            { label: 'Cliente', key: 'nome' },
            { label: 'Escritório', key: 'escritorio' },
            { label: 'Créditos', align: 'right', html: true,
              get: r => `<span class="val-pos">${UI.fmtMoney(r.creditos)}</span>` },
            { label: 'Débitos',  align: 'right', html: true,
              get: r => `<span class="val-neg">${UI.fmtMoney(r.debitos)}</span>` },
            { label: 'Saldo',    align: 'right', html: true,
              get: r => `<strong class="${r.saldo<0?'val-neg':'val-pos'}">${UI.fmtMoney(r.saldo)}</strong>` },
            { label: 'Média Op.', align: 'right', get: r => UI.fmtMoney(r.media_operacao) },
            { label: 'Situação', html: true, get: r => situacaoPill(r.situacao) },
          ],
          rows: list,
          empty: 'Sem saldos para mostrar.',
        });
      };
      draw();
      ['sl-search','sl-esc','sl-sit'].forEach(id =>
        document.getElementById(id).addEventListener('input', draw));
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }
  return { render };
})();
