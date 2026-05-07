window.VIEW_acionamentos = (() => {
  let clientesCache = [];

  async function render() {
    const el = document.getElementById('view-acionamentos');
    el.innerHTML = '<div class="muted">Carregando…</div>';
    try {
      const [reqs, clientes] = await Promise.all([
        API.get('/api/partner-requests'),
        API.get('/api/clientes').catch(() => []),
      ]);
      clientesCache = clientes;
      const me = AUTH.user();
      const canCreate = me.role === 'ADM' || me.role === 'SAYGO' || me.role === 'CLIENT';
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <div class="muted small">${reqs.length} solicitação(ões)</div>
          ${canCreate ? '<button class="btn primary" id="ac-new">+ Acionar parceiro</button>' : ''}
        </div>
        <div id="ac-list"></div>`;
      drawList(reqs);
      if (canCreate) document.getElementById('ac-new').onclick = openForm;
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  function drawList(reqs) {
    const el = document.getElementById('ac-list');
    if (!reqs.length) {
      el.innerHTML = '<div class="muted small" style="padding:1rem">Sem acionamentos.</div>';
      return;
    }
    el.innerHTML = UI.table({
      cols: [
        { label: 'Quando', get: r => UI.fmtDateTime(r.createdAt) },
        { label: 'Cliente', get: r => r.cliente?.nome },
        { label: 'Escritório', get: r => r.partnerOfficeName },
        { label: 'Tipo', key: 'type' },
        { label: 'Status', html: true, get: r => {
          const c = r.status==='OPEN'?'var(--amber)' : r.status==='IN_PROGRESS'?'var(--blue)'
                  : r.status==='RESOLVED'?'var(--green)':'var(--t3)';
          return `<span style="color:${c};font-weight:700">${r.status}</span>`;
        }},
        { label: 'Solicitado por', get: r => r.requestedBy?.name },
        { label: 'Mensagem', key: 'message' },
        { label: '', html: true, get: r => `<button class="btn small" data-edit="${r.id}">Abrir</button>` },
      ],
      rows: reqs,
    });
    el.addEventListener('click', e => {
      const id = e.target.getAttribute('data-edit');
      if (id) openDetail(id, reqs.find(r => r.id===id));
    });
  }

  function openForm() {
    const me = AUTH.user();
    let cliOpts;
    if (me.role === 'CLIENT') {
      const myCli = clientesCache[0];
      cliOpts = myCli ? `<option value="${myCli.id}" selected>${UI.escapeHtml(myCli.nome)}</option>` : '';
    } else {
      cliOpts = clientesCache.filter(c => c.escritorio).map(c =>
        `<option value="${c.id}">${UI.escapeHtml(c.nome)} — ${UI.escapeHtml(c.escritorio)}</option>`).join('');
    }
    UI.openModal('Acionar parceiro', `
      <form id="form-ac" class="form-grid">
        <div class="full"><label>Cliente *</label>
          <select name="clienteId" required ${me.role==='CLIENT'?'disabled':''}>
            <option value="">—</option>${cliOpts}
          </select>
        </div>
        <div class="full"><label>Tipo *</label>
          <select name="type" required>
            <option value="ALIMENTACAO_CONTA_GRAFICA" selected>Alimentação de conta gráfica</option>
          </select>
        </div>
        <div class="full"><label>Mensagem</label>
          <textarea name="message" rows="4" placeholder="Detalhes do que precisa…"></textarea>
        </div>
        <div class="full muted small">
          ⚠ As regras de cálculo e os campos de payload serão configurados em versão futura.
          Por enquanto, descreva a necessidade no campo "Mensagem" acima.
        </div>
        <div class="full form-actions">
          <button type="button" class="btn" id="ac-cancel">Cancelar</button>
          <button type="submit" class="btn primary">Enviar</button>
        </div>
      </form>`);
    document.getElementById('ac-cancel').onclick = UI.closeModal;
    document.getElementById('form-ac').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const data = Object.fromEntries(fd.entries());
      if (me.role === 'CLIENT' && !data.clienteId) data.clienteId = clientesCache[0]?.id;
      try {
        await API.post('/api/partner-requests', data);
        UI.toast('Acionamento enviado'); UI.closeModal(); render();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  function openDetail(id, r) {
    const isStaff = AUTH.isStaff() || (AUTH.user().role === 'PARTNER');
    UI.openModal(`Acionamento — ${r.cliente?.nome || ''}`, `
      <div><strong>Tipo:</strong> ${r.type}</div>
      <div><strong>Status:</strong> ${r.status}</div>
      <div><strong>Escritório alvo:</strong> ${UI.escapeHtml(r.partnerOfficeName)}</div>
      <div><strong>Solicitado por:</strong> ${UI.escapeHtml(r.requestedBy?.name || '')} em ${UI.fmtDateTime(r.createdAt)}</div>
      ${r.resolvedAt ? `<div><strong>Resolvido por:</strong> ${UI.escapeHtml(r.resolvedBy?.name || '')} em ${UI.fmtDateTime(r.resolvedAt)}</div>` : ''}
      <div style="margin-top:.5rem"><strong>Mensagem:</strong><br>${UI.escapeHtml(r.message || '—')}</div>
      ${isStaff ? `
        <div class="form-actions" style="margin-top:1rem">
          <button class="btn" data-st="IN_PROGRESS">Em andamento</button>
          <button class="btn primary" data-st="RESOLVED">Resolver</button>
          <button class="btn danger" data-st="CANCELED">Cancelar</button>
        </div>` : ''}
    `);
    if (isStaff) {
      document.getElementById('modal-body').addEventListener('click', async e => {
        const st = e.target.getAttribute('data-st');
        if (!st) return;
        try {
          await API.put(`/api/partner-requests/${id}`, { status: st });
          UI.toast('Atualizado'); UI.closeModal(); render();
        } catch (err) { UI.toast(err.message, 'err'); }
      });
    }
  }

  return { render };
})();
