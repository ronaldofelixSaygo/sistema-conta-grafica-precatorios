window.VIEW_kanban = (() => {
  let meta = null, cards = [], clientesCache = [];

  async function render() {
    const el = document.getElementById('view-kanban');
    el.innerHTML = '<div class="muted">Carregando…</div>';
    try {
      [meta, cards] = await Promise.all([
        API.get('/api/kanban/meta'),
        API.get('/api/kanban/cards'),
      ]);
      if (!clientesCache.length) {
        try { clientesCache = await API.get('/api/clientes'); } catch {}
      }
      drawBoard();
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  function drawBoard() {
    const el = document.getElementById('view-kanban');
    const isStaff = AUTH.isStaff();
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;gap:.5rem;flex-wrap:wrap">
        <div class="muted small">${cards.length} card(s) no Kanban</div>
        ${isStaff ? '<button class="btn primary" id="kb-new">+ Novo card</button>' : ''}
      </div>
      <div class="kb-board" id="kb-board"></div>`;

    const board = document.getElementById('kb-board');
    board.innerHTML = meta.stagesOrder.map(stage => {
      const stageMeta = meta.stageMeta[stage];
      const list = cards.filter(c => c.currentStage === stage);
      return `
        <div class="kb-col" data-stage="${stage}">
          <div class="kb-col-head">
            <strong>${UI.escapeHtml(stageMeta.label)}</strong>
            <span class="muted small">${list.length}</span>
          </div>
          <div class="kb-col-body">
            ${list.map(cardHtml).join('') || '<div class="muted small" style="padding:.5rem;text-align:center">vazio</div>'}
          </div>
        </div>`;
    }).join('');

    // click no card → abrir modal
    board.addEventListener('click', e => {
      const cd = e.target.closest('.kb-card');
      if (cd) openCardModal(cd.dataset.id);
    });

    if (isStaff) document.getElementById('kb-new').onclick = openNewCardModal;
  }

  function cardHtml(c) {
    const stageMeta = meta.stageMeta[c.currentStage];
    const sp = c.stages.find(s => s.stage === c.currentStage);
    const slaInfo = sp?.slaDeadline
      ? (() => {
          const d = new Date(sp.slaDeadline);
          const overdue = d < new Date();
          return `<span style="color:${overdue?'var(--red)':'var(--amber)'};font-size:11px">
            SLA: ${UI.fmtDate(d)} ${overdue?'(atrasado)':''}
          </span>`;
        })()
      : '';
    return `
      <div class="kb-card" data-id="${c.id}">
        <div style="font-weight:700;margin-bottom:4px">${UI.escapeHtml(c.clienteNome)}</div>
        <div class="muted small">${UI.escapeHtml(c.clienteEscritorio || 'sem escritório')}</div>
        <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center">
          ${slaInfo}
          ${c.attachments ? `<span class="muted small">📎 ${c.attachments}</span>` : ''}
        </div>
      </div>`;
  }

  function openNewCardModal() {
    // Mostra apenas clientes que ainda não têm card
    const usados = new Set(cards.map(c => c.clienteId));
    const disponiveis = clientesCache.filter(c => !usados.has(c.id));
    const opts = disponiveis.map(c =>
      `<option value="${c.id}">${UI.escapeHtml(c.nome)}${c.escritorio?` — ${UI.escapeHtml(c.escritorio)}`:''}</option>`).join('');
    UI.openModal('Novo card no Kanban', `
      <form id="form-kb-new" class="form-grid">
        <div class="full"><label>Cliente *</label>
          <select name="clienteId" required>
            <option value="">—</option>${opts}
          </select>
        </div>
        <div class="full"><label>Notas (opcional)</label>
          <textarea name="notes" rows="3"></textarea>
        </div>
        <div class="full form-actions">
          <button type="button" class="btn" id="kb-cancel">Cancelar</button>
          <button type="submit" class="btn primary">Criar</button>
        </div>
      </form>`);
    document.getElementById('kb-cancel').onclick = UI.closeModal;
    document.getElementById('form-kb-new').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        await API.post('/api/kanban/cards', Object.fromEntries(fd.entries()));
        UI.toast('Card criado'); UI.closeModal(); render();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  async function openCardModal(cardId) {
    try {
      const card = await API.get(`/api/kanban/cards/${cardId}`);
      UI.openModal(`${card.cliente.nome} — ${meta.stageMeta[card.currentStage].label}`, `
        <div class="kb-detail">
          <div class="muted small" style="margin-bottom:.5rem">
            Iniciado: ${UI.fmtDateTime(card.startedAt)}
            ${card.completedAt ? `· Concluído: ${UI.fmtDateTime(card.completedAt)}` : ''}
          </div>
          <div id="kb-stages">${card.stages.map(s => stageHtml(card, s)).join('')}</div>
        </div>`);

      // Bind events
      const root = document.getElementById('kb-stages');
      root.addEventListener('click', async ev => {
        const btn = ev.target;
        if (btn.dataset.action === 'toggle-checklist') {
          await toggleChecklist(card.id, btn.dataset.stage, parseInt(btn.dataset.idx,10));
        } else if (btn.dataset.action === 'complete-stage') {
          if (!confirm('Concluir esta etapa? O card avança para a próxima.')) return;
          try {
            await API.post(`/api/kanban/cards/${card.id}/stages/${btn.dataset.stage}/complete`);
            UI.toast('Etapa concluída'); UI.closeModal(); render();
          } catch (e) { UI.toast(e.message, 'err'); }
        } else if (btn.dataset.action === 'move-to') {
          const to = prompt(`Mover para qual etapa?\n${meta.stagesOrder.join(', ')}`, card.currentStage);
          if (!to || to === card.currentStage) return;
          try {
            await API.post(`/api/kanban/cards/${card.id}/move`, { toStage: to });
            UI.toast('Movido'); UI.closeModal(); render();
          } catch (e) { UI.toast(e.message, 'err'); }
        } else if (btn.dataset.action === 'upload') {
          const inp = document.createElement('input');
          inp.type = 'file';
          inp.onchange = async () => {
            if (!inp.files[0]) return;
            const fd = new FormData();
            fd.append('file', inp.files[0]);
            if (btn.dataset.spid) fd.append('stageProgressId', btn.dataset.spid);
            try {
              await fetch(`/api/kanban/cards/${card.id}/attachments`, {
                method: 'POST', credentials: 'include', body: fd,
              }).then(r => { if (!r.ok) throw new Error('Upload falhou'); });
              UI.toast('Arquivo anexado'); openCardModal(card.id);
            } catch (e) { UI.toast(e.message, 'err'); }
          };
          inp.click();
        } else if (btn.dataset.action === 'download') {
          window.open(`/api/kanban/attachments/${btn.dataset.attid}`, '_blank');
        } else if (btn.dataset.action === 'delete-att') {
          if (!confirm('Excluir anexo?')) return;
          try {
            await API.del(`/api/kanban/attachments/${btn.dataset.attid}`);
            UI.toast('Excluído'); openCardModal(card.id);
          } catch (e) { UI.toast(e.message, 'err'); }
        }
      });
    } catch (e) { UI.toast(e.message, 'err'); }

    async function toggleChecklist(cardId, stage, idx) {
      // Pega o estado atual e inverte
      const card = await API.get(`/api/kanban/cards/${cardId}`);
      const sp = card.stages.find(s => s.stage === stage);
      const cl = Array.isArray(sp.checklist) ? sp.checklist : [];
      cl[idx].done = !cl[idx].done;
      try {
        await API.put(`/api/kanban/cards/${cardId}/stages/${stage}`, { checklist: cl });
        openCardModal(cardId);
      } catch (e) { UI.toast(e.message, 'err'); }
    }
  }

  function stageHtml(card, sp) {
    const m = meta.stageMeta[sp.stage];
    const checklist = Array.isArray(sp.checklist) ? sp.checklist : [];
    const isCurrent = card.currentStage === sp.stage;
    const statusColor = sp.status === 'COMPLETED' ? 'var(--green)'
                      : sp.status === 'IN_PROGRESS' ? 'var(--amber)'
                      : sp.status === 'BLOCKED' ? 'var(--red)' : 'var(--t3)';
    const slaDeadline = sp.startedAt
      ? new Date(new Date(sp.startedAt).getTime() + sp.slaHours * 3600_000)
      : null;
    const overdue = slaDeadline && sp.status !== 'COMPLETED' && slaDeadline < new Date();

    return `
      <div class="kb-stage ${isCurrent?'current':''}">
        <div class="kb-stage-head">
          <div>
            <strong>${UI.escapeHtml(m.label)}</strong>
            <span class="muted small" style="margin-left:.5rem;color:${statusColor}">● ${sp.status}</span>
          </div>
          <div class="muted small">
            SLA: ${sp.slaHours}h
            ${slaDeadline ? `· prevista: ${UI.fmtDate(slaDeadline)}` : ''}
            ${sp.realizedHours != null ? `· realizada em ${sp.realizedHours}h` : ''}
            ${overdue ? '<span style="color:var(--red);margin-left:.5rem">⚠ atrasado</span>' : ''}
          </div>
        </div>
        <div class="muted small" style="margin:4px 0">
          Responsável: ${sp.responsibleUser ? UI.escapeHtml(sp.responsibleUser.name) : (sp.responsibleRole || '—')}
        </div>
        <ul class="kb-checklist">
          ${checklist.map((it, idx) => `
            <li>
              <button class="kb-check ${it.done?'done':''}" data-action="toggle-checklist" data-stage="${sp.stage}" data-idx="${idx}">${it.done?'✓':'○'}</button>
              <span class="${it.done?'done':''}">${UI.escapeHtml(it.label)}</span>
            </li>`).join('') || '<li class="muted small">Sem itens no checklist.</li>'}
        </ul>
        ${sp.attachments?.length ? `
          <div style="margin-top:.5rem">
            <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Anexos da etapa</strong>
            <ul class="kb-attachments">
              ${sp.attachments.map(a => `
                <li>📎 <a href="#" data-action="download" data-attid="${a.id}">${UI.escapeHtml(a.filename)}</a>
                  <span class="muted small">(${(a.size/1024).toFixed(1)} KB)</span>
                  <button class="btn small ghost" data-action="delete-att" data-attid="${a.id}">×</button>
                </li>`).join('')}
            </ul>
          </div>` : ''}
        <div class="kb-stage-actions">
          <button class="btn small" data-action="upload" data-spid="${sp.id}">📎 Anexar</button>
          ${isCurrent && sp.status !== 'COMPLETED' ? `<button class="btn small primary" data-action="complete-stage" data-stage="${sp.stage}">✓ Concluir etapa</button>` : ''}
          ${AUTH.isStaff() ? `<button class="btn small" data-action="move-to">Mover…</button>` : ''}
        </div>
      </div>`;
  }

  return { render };
})();
