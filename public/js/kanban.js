window.VIEW_kanban = (() => {
  let meta = null, cards = [], clientesCache = [], parceirosCache = [];
  // estado local do modal (evita refetch a cada toggle)
  let openCard = null;

  async function render() {
    const el = document.getElementById('view-kanban');
    el.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      [meta, cards] = await Promise.all([
        API.get('/api/kanban/meta', null, { ttl: 120000 }),
        API.get('/api/kanban/cards'),
      ]);
      if (!clientesCache.length) {
        try { clientesCache = await API.get('/api/clientes', null, { ttl: 60000 }); } catch {}
      }
      try { parceirosCache = await API.get('/api/parceiros', null, { ttl: 60000 }); } catch { parceirosCache = []; }
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
      const stageMeta = meta.stageMeta[stage] || { label: stage };
      const list = cards.filter(c => c.currentStage === stage);
      const isDone = stage === 'CONCLUIDO';
      return `
        <div class="kb-col ${isDone?'col-done':''}" data-stage="${stage}">
          <div class="kb-col-head">
            <strong>${UI.escapeHtml(stageMeta.label)}</strong>
            <span class="muted small">${list.length}</span>
          </div>
          <div class="kb-col-body">
            ${list.map(cardHtml).join('') || '<div class="muted small" style="padding:.5rem;text-align:center">vazio</div>'}
          </div>
        </div>`;
    }).join('');

    board.addEventListener('click', e => {
      const cd = e.target.closest('.kb-card');
      if (cd) openCardModal(cd.dataset.id);
    });
    if (isStaff) document.getElementById('kb-new').onclick = openNewCardModal;
  }

  function cardHtml(c) {
    const isDone = c.currentStage === 'CONCLUIDO';
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
      <div class="kb-card ${isDone?'done':''}" data-id="${c.id}" data-current="${c.currentStage}">
        <div style="font-weight:700;margin-bottom:4px">${UI.escapeHtml(c.clienteNome)}</div>
        <div class="muted small">${UI.escapeHtml(c.clienteEscritorio || 'sem escritorio')}</div>
        <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center">
          ${isDone ? '<span style="color:var(--green);font-weight:700;font-size:11px">[OK] CONCLUIDO</span>' : slaInfo}
          ${c.attachments ? `<span class="muted small">@ ${c.attachments}</span>` : ''}
        </div>
      </div>`;
  }

  // ------ NOVO CARD: form com parceiros para todas as etapas ------
  async function openNewCardModal() {
    // Recarrega a lista de clientes sem cache. Sem isso, clientes cadastrados
    // em outra view enquanto o Kanban está aberto não aparecem no select.
    try {
      API.invalidate?.('/api/clientes');
      clientesCache = await API.get('/api/clientes', null, { ttl: 0 });
    } catch {}
    const usados = new Set(cards.map(c => c.clienteId));
    const disponiveis = clientesCache.filter(c => !usados.has(c.id));
    const cliOpts = disponiveis.map(c =>
      `<option value="${c.id}">${UI.escapeHtml(c.nome)}${c.escritorio?` -- ${UI.escapeHtml(c.escritorio)}`:''}</option>`).join('');

    const stageRows = meta.stagesOrder.filter(s => s !== 'CONCLUIDO').map(stage => {
      const m = meta.stageMeta[stage];
      const ps = parceirosCache.filter(p => (p.stages||[]).includes(stage));
      const opts = ps.map(p =>
        `<option value="${p.id}">${UI.escapeHtml(p.nome)}${p.isSaygo?' (Saygo)':''}</option>`).join('');
      return `
        <div class="full"><label>${UI.escapeHtml(m.label)} -- interveniente responsavel</label>
          <select name="stage_${stage}">
            <option value="">-- nao definido --</option>${opts}
          </select>
          ${ps.length===0?'<div class="muted small" style="margin-top:2px">Nenhum interveniente cadastrado para esta etapa.</div>':''}
        </div>`;
    }).join('');

    UI.openModal('Novo card no Kanban', `
      <form id="form-kb-new" class="form-grid">
        <div class="full"><label>Cliente *</label>
          <select name="clienteId" required>
            <option value="">--</option>${cliOpts}
          </select>
        </div>
        <div class="full"><label>Notas (opcional)</label>
          <textarea name="notes" rows="2"></textarea>
        </div>
        <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.4rem">
          <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Intervenientes responsaveis (definir agora)</strong>
        </div>
        ${stageRows}
        <div class="full form-actions">
          <button type="button" class="btn" id="kb-cancel">Cancelar</button>
          <button type="submit" class="btn primary">Criar</button>
        </div>
      </form>`);
    document.getElementById('kb-cancel').onclick = UI.closeModal;
    document.getElementById('form-kb-new').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const stageParceiros = {};
      for (const stage of meta.stagesOrder) {
        const v = fd.get('stage_' + stage);
        if (v) stageParceiros[stage] = v;
      }
      const data = {
        clienteId: fd.get('clienteId'),
        notes: fd.get('notes'),
        stageParceiros,
      };
      try {
        await API.post('/api/kanban/cards', data);
        UI.toast('Card criado'); UI.closeModal(); render();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  // ------ MODAL DE DETALHE DO CARD ------
  async function openCardModal(cardId) {
    try {
      openCard = await API.get(`/api/kanban/cards/${cardId}`);
    } catch (e) { UI.toast(e.message, 'err'); return; }
    renderCardModal();
  }

  function renderCardModal() {
    const card = openCard;
    // Ordena as etapas pelo `order` da config (meta.stagesOrder)
    const orderIdx = (key) => {
      const i = meta.stagesOrder.indexOf(key);
      return i < 0 ? 999 : i;
    };
    const orderedStages = [...card.stages].sort((a, b) => orderIdx(a.stage) - orderIdx(b.stage));
    UI.openModal(`${card.cliente.nome} -- ${meta.stageMeta[card.currentStage]?.label || card.currentStage}`, `
      <div class="kb-detail">
        <div class="muted small" style="margin-bottom:.5rem">
          Iniciado: ${UI.fmtDateTime(card.startedAt)}
          ${card.completedAt ? `* Concluido: ${UI.fmtDateTime(card.completedAt)}` : ''}
        </div>
        <div id="kb-stages">${orderedStages.map(s => stageHtml(card, s)).join('')}</div>
      </div>`);

    document.getElementById('kb-stages').addEventListener('click', handleStageClick);
  }

  async function handleStageClick(ev) {
    const btn = ev.target;
    const card = openCard;
    if (!card) return;

    if (btn.dataset.action === 'toggle-checklist') {
      await toggleChecklistOptimistic(btn);
    }
    else if (btn.dataset.action === 'complete-stage') {
      await tryCompleteStage(btn.dataset.stage);
    }
    else if (btn.dataset.action === 'move-to') {
      moveStageDialog();
    }
    else if (btn.dataset.action === 'upload') {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.onchange = async () => {
        if (!inp.files[0]) return;
        const fd = new FormData();
        fd.append('file', inp.files[0]);
        if (btn.dataset.spid) fd.append('stageProgressId', btn.dataset.spid);
        try {
          const r = await fetch(`/api/kanban/cards/${card.id}/attachments`,
            { method: 'POST', credentials: 'include', body: fd });
          if (!r.ok) throw new Error('Upload falhou');
          UI.toast('Arquivo anexado');
          await refreshCardSilent();
          renderCardModal();
        } catch (e) { UI.toast(e.message, 'err'); }
      };
      inp.click();
    }
    else if (btn.dataset.action === 'view-att') {
      VIEWER.open({
        url: `/api/kanban/attachments/${btn.dataset.attid}`,
        filename: btn.dataset.filename || 'arquivo',
        mimeType: btn.dataset.mime || '',
      });
    }
    else if (btn.dataset.action === 'delete-att') {
      if (!confirm('Excluir anexo?')) return;
      try {
        await API.del(`/api/kanban/attachments/${btn.dataset.attid}`);
        UI.toast('Excluido');
        await refreshCardSilent();
        renderCardModal();
      } catch (e) { UI.toast(e.message, 'err'); }
    }
    else if (btn.dataset.action === 'set-parceiro') {
      pickParceiro(btn.dataset.stage);
    }
  }

  // toggle otimista do checklist (UI primeiro, request em background)
  async function toggleChecklistOptimistic(btn) {
    const stage = btn.dataset.stage;
    const idx   = parseInt(btn.dataset.idx, 10);
    const sp = openCard.stages.find(s => s.stage === stage);
    if (!sp) return;
    const cl = Array.isArray(sp.checklist) ? sp.checklist : [];
    cl[idx].done = !cl[idx].done;
    // re-render parcial: atualiza apenas o item visualmente
    btn.classList.toggle('done', cl[idx].done);
    btn.textContent = cl[idx].done ? 'OK' : 'O';
    btn.classList.add('saving');
    const span = btn.nextElementSibling;
    if (span) span.classList.toggle('done', cl[idx].done);

    // atualiza estado do botão "Concluir etapa" e flag visual da etapa
    const stageEl = btn.closest('.kb-stage');
    const allDone = cl.length > 0 && cl.every(it => it.done);
    if (stageEl) stageEl.classList.toggle('ready-to-complete', allDone);

    try {
      await API.put(`/api/kanban/cards/${openCard.id}/stages/${stage}`, { checklist: cl });
    } catch (e) {
      // reverte em caso de falha
      cl[idx].done = !cl[idx].done;
      btn.classList.toggle('done', cl[idx].done);
      btn.textContent = cl[idx].done ? 'OK' : 'O';
      if (span) span.classList.toggle('done', cl[idx].done);
      UI.toast(e.message, 'err');
    } finally {
      btn.classList.remove('saving');
    }
  }

  async function tryCompleteStage(stage) {
    const sp = openCard.stages.find(s => s.stage === stage);
    const cl = Array.isArray(sp.checklist) ? sp.checklist : [];
    const pending = cl.filter(it => !it.done).length;
    let force = false;
    if (pending > 0) {
      if (!confirm(`Esta etapa tem ${pending} item(ns) pendente(s).\nConcluir mesmo assim?`)) return;
      force = true;
    } else {
      if (!confirm('Concluir esta etapa? O card avanca para a proxima.')) return;
    }
    try {
      await API.post(`/api/kanban/cards/${openCard.id}/stages/${stage}/complete`, { force });
      UI.toast('Etapa concluida'); UI.closeModal(); render();
    } catch (e) { UI.toast(e.message, 'err'); }
  }

  function moveStageDialog() {
    const opts = meta.stagesOrder.map(s =>
      `<option value="${s}" ${s===openCard.currentStage?'selected':''}>${UI.escapeHtml(meta.stageMeta[s].label)}</option>`).join('');
    const old = document.getElementById('modal-body').innerHTML;
    document.getElementById('modal-body').innerHTML = `
      <div class="form-grid">
        <div class="full"><label>Mover para etapa</label>
          <select id="mv-select">${opts}</select>
        </div>
        <div class="full muted small">
          Atencao: as etapas anteriores serao marcadas como concluidas, e as posteriores como pendentes.
        </div>
        <div class="full form-actions">
          <button class="btn" id="mv-cancel">Voltar</button>
          <button class="btn primary" id="mv-save">Mover</button>
        </div>
      </div>`;
    document.getElementById('mv-cancel').onclick = renderCardModal;
    document.getElementById('mv-save').onclick = async () => {
      const to = document.getElementById('mv-select').value;
      if (!to || to === openCard.currentStage) return UI.toast('Sem mudanca');
      try {
        await API.post(`/api/kanban/cards/${openCard.id}/move`, { toStage: to });
        UI.toast('Movido'); UI.closeModal(); render();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  function pickParceiro(stage) {
    const ps = parceirosCache.filter(p => (p.stages||[]).includes(stage));
    if (!ps.length) {
      if (confirm('Nenhum parceiro cadastrado para esta etapa. Quer ir cadastrar?')) {
        UI.closeModal(); APP.showView('parceiros');
      }
      return;
    }
    const opts = ps.map(p =>
      `<option value="${p.id}">${UI.escapeHtml(p.nome)}${p.isSaygo?' (Saygo)':''}${p.cnpj?` -- ${p.cnpj}`:''}</option>`).join('');
    const old = document.getElementById('modal-body').innerHTML;
    document.getElementById('modal-body').innerHTML = `
      <div class="form-grid">
        <div class="full"><label>Selecione o parceiro responsavel por esta etapa</label>
          <select id="pp-select"><option value="">-- Sem parceiro --</option>${opts}</select>
        </div>
        <div class="full form-actions">
          <button class="btn" id="pp-cancel">Voltar</button>
          <button class="btn primary" id="pp-save">Salvar</button>
        </div>
      </div>`;
    document.getElementById('pp-cancel').onclick = renderCardModal;
    document.getElementById('pp-save').onclick = async () => {
      const parceiroId = document.getElementById('pp-select').value || null;
      try {
        await API.put(`/api/kanban/cards/${openCard.id}/stages/${stage}`, { parceiroId });
        UI.toast('Interveniente definido');
        // Atualiza imediatamente em memória pra UI refletir mesmo se o GET falhar
        const stageObj = openCard.stages.find(x => x.stage === stage);
        if (stageObj) {
          if (parceiroId) {
            const p = parceirosCache.find(x => x.id === parceiroId);
            stageObj.parceiroId = parceiroId;
            stageObj.parceiro = p ? { id: p.id, nome: p.nome, isSaygo: !!p.isSaygo } : null;
          } else {
            stageObj.parceiroId = null;
            stageObj.parceiro = null;
          }
        }
        // Re-busca completa do card pra trazer relações fresh do banco
        try { openCard = await API.get(`/api/kanban/cards/${openCard.id}`); }
        catch (err) { console.warn('refresh card falhou:', err); }
        renderCardModal();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  async function refreshCardSilent() {
    try { openCard = await API.get(`/api/kanban/cards/${openCard.id}`); } catch {}
  }

  function stageHtml(card, sp) {
    const m = meta.stageMeta[sp.stage] || { label: sp.stage };
    const checklist = Array.isArray(sp.checklist) ? sp.checklist : [];
    const isCurrent = card.currentStage === sp.stage;
    const allDone = checklist.length > 0 && checklist.every(it => it.done);
    const statusColor = sp.status === 'COMPLETED' ? 'var(--green)'
                      : sp.status === 'IN_PROGRESS' ? 'var(--amber)'
                      : sp.status === 'BLOCKED' ? 'var(--red)' : 'var(--t3)';
    const slaDeadline = sp.startedAt
      ? new Date(new Date(sp.startedAt).getTime() + sp.slaHours * 3600_000)
      : null;
    const overdue = slaDeadline && sp.status !== 'COMPLETED' && slaDeadline < new Date();
    const isStaff = AUTH.isStaff();

    const parceiroLine = sp.parceiro
      ? `<strong>${UI.escapeHtml(sp.parceiro.nome)}</strong>${sp.parceiro.isSaygo?' (Saygo)':''}`
      : '<em class="muted">nao definido</em>';

    return `
      <div class="kb-stage ${isCurrent?'current':''} ${isCurrent && allDone?'ready-to-complete':''}">
        <div class="kb-stage-head">
          <div>
            <strong>${UI.escapeHtml(m.label)}</strong>
            <span class="muted small" style="margin-left:.5rem;color:${statusColor}">. ${sp.status}</span>
          </div>
          <div class="muted small">
            SLA: ${sp.slaHours}h
            ${slaDeadline ? `* prevista: ${UI.fmtDate(slaDeadline)}` : ''}
            ${sp.realizedHours != null ? `* realizada em ${sp.realizedHours}h` : ''}
            ${overdue ? '<span style="color:var(--red);margin-left:.5rem">! atrasado</span>' : ''}
          </div>
        </div>
        <div class="muted small" style="margin:4px 0">
          Interveniente: ${parceiroLine}
          ${isStaff ? `<button class="btn small ghost" data-action="set-parceiro" data-stage="${sp.stage}" style="margin-left:.4rem">Selecionar...</button>` : ''}
        </div>
        <div class="muted small" style="margin:4px 0">
          Responsavel: ${sp.responsibleUser ? UI.escapeHtml(sp.responsibleUser.name) : (sp.responsibleRole || '--')}
        </div>
        <ul class="kb-checklist">
          ${checklist.map((it, idx) => `
            <li>
              <button class="kb-check ${it.done?'done':''}" data-action="toggle-checklist" data-stage="${sp.stage}" data-idx="${idx}">${it.done?'OK':'O'}</button>
              <span class="${it.done?'done':''}">${UI.escapeHtml(it.label)}</span>
            </li>`).join('') || '<li class="muted small">Sem itens no checklist.</li>'}
        </ul>
        ${sp.attachments?.length ? `
          <div style="margin-top:.5rem">
            <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Anexos da etapa</strong>
            <ul class="kb-attachments">
              ${sp.attachments.map(a => `
                <li>@ <a href="#" data-action="view-att" data-attid="${a.id}" data-filename="${UI.escapeHtml(a.filename)}" data-mime="${a.mimeType||''}">${UI.escapeHtml(a.filename)}</a>
                  <span class="muted small">(${(a.size/1024).toFixed(1)} KB)</span>
                  <button class="btn small ghost" data-action="delete-att" data-attid="${a.id}">x</button>
                </li>`).join('')}
            </ul>
          </div>` : ''}
        <div class="kb-stage-actions">
          <button class="btn small" data-action="upload" data-spid="${sp.id}">+ Anexar</button>
          ${isCurrent && sp.status !== 'COMPLETED' ? `<button class="btn small primary kb-complete-btn" data-action="complete-stage" data-stage="${sp.stage}">Concluir etapa</button>` : ''}
          ${isStaff ? `<button class="btn small" data-action="move-to">Mover...</button>` : ''}
        </div>
      </div>`;
  }

  return { render };
})();
