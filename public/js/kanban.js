window.VIEW_kanban = (() => {
  let meta = null, cards = [], clientesCache = [], parceirosCache = [];
  // estado local do modal (evita refetch a cada toggle)
  let openCard = null;

  // Filtros visíveis na barra superior do Kanban. Persiste em localStorage
  // pra não perder ao navegar pra outra view e voltar.
  const FILTERS_KEY = 'vision.kanban.filters';
  let filters = (() => {
    try { return JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}'); }
    catch { return {}; }
  })();
  function saveFilters() {
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch {}
  }
  function _norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]','g'), '');
  }

  // Aplica os filtros sobre `cards`. Retorna o array filtrado.
  function filteredCards() {
    let out = cards.slice();
    if (filters.search) {
      const q = _norm(filters.search);
      out = out.filter(c =>
        _norm(c.clienteNome).includes(q) ||
        _norm(c.clienteEscritorio).includes(q)
      );
    }
    if (filters.escritorio) {
      out = out.filter(c => (c.clienteEscritorio || '').trim() === filters.escritorio);
    }
    if (filters.dataIni) {
      const d = new Date(filters.dataIni); d.setHours(0,0,0,0);
      out = out.filter(c => c.startedAt && new Date(c.startedAt) >= d);
    }
    if (filters.dataFim) {
      const d = new Date(filters.dataFim); d.setHours(23,59,59,999);
      out = out.filter(c => c.startedAt && new Date(c.startedAt) <= d);
    }
    if (filters.slaStatus) {
      out = out.filter(c => {
        const sp = c.stages.find(s => s.stage === c.currentStage);
        const hasDeadline = !!sp?.slaDeadline;
        if (filters.slaStatus === 'sem')      return !hasDeadline;
        if (!hasDeadline) return false;       // ok/atrasado exigem SLA definido
        const overdue = new Date(sp.slaDeadline) < new Date();
        if (filters.slaStatus === 'atrasado') return overdue;
        if (filters.slaStatus === 'ok')       return !overdue;
        return false;
      });
    }
    if (filters.anexo === 'com')  out = out.filter(c => (c.attachments || 0) > 0);
    if (filters.anexo === 'sem')  out = out.filter(c => !c.attachments);
    if (filters.responsavel) {
      if (filters.responsavel === 'sem') {
        out = out.filter(c => {
          const sp = c.stages.find(s => s.stage === c.currentStage);
          return !sp?.parceiroId && !sp?.responsibleUserId;
        });
      } else {
        // Filtra por parceiroId específico (qualquer stage com esse parceiro)
        out = out.filter(c => c.stages.some(s => s.parceiroId === filters.responsavel));
      }
    }
    return out;
  }

  // Coleta opções únicas pros dropdowns (calculadas dos cards atuais)
  function getFilterOptions() {
    const escSet = new Set();
    const respMap = new Map(); // parceiroId → nome
    for (const c of cards) {
      const esc = (c.clienteEscritorio || '').trim();
      if (esc) escSet.add(esc);
      for (const s of (c.stages || [])) {
        if (s.parceiroId && s.parceiro?.nome) respMap.set(s.parceiroId, s.parceiro.nome);
      }
    }
    return {
      escritorios: [...escSet].sort(),
      responsaveis: [...respMap.entries()]
        .map(([id, nome]) => ({ id, nome }))
        .sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    };
  }

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

  // Renderiza tudo (toolbar + counter + board). Chamado quando o conjunto
  // de cards muda (ex.: load inicial, depois de criar/atualizar card).
  function drawBoard() {
    const el = document.getElementById('view-kanban');
    const isStaff = AUTH.isStaff();
    const { escritorios, responsaveis } = getFilterOptions();
    const hasFiltro = hasAnyFilter();

    el.innerHTML = `
      <div class="kb-toolbar">
        <input id="kb-f-search" class="kb-input" placeholder="🔍 Buscar cliente ou escritório..." value="${UI.escapeHtml(filters.search || '')}">
        <select id="kb-f-escritorio" data-no-combo>
          <option value="">Todos escritórios</option>
          ${escritorios.map(e => `<option value="${UI.escapeHtml(e)}" ${filters.escritorio===e?'selected':''}>${UI.escapeHtml(e)}</option>`).join('')}
        </select>
        <select id="kb-f-sla" data-no-combo>
          <option value="">SLA: todos</option>
          <option value="ok"        ${filters.slaStatus==='ok'?'selected':''}>✅ Dentro do SLA</option>
          <option value="atrasado"  ${filters.slaStatus==='atrasado'?'selected':''}>⚠ Atrasados</option>
          <option value="sem"       ${filters.slaStatus==='sem'?'selected':''}>— Sem SLA definido</option>
        </select>
        <input id="kb-f-dataini" type="date" title="Criados desde" value="${filters.dataIni||''}">
        <input id="kb-f-datafim" type="date" title="Criados até"   value="${filters.dataFim||''}">
        <select id="kb-f-anexo" data-no-combo>
          <option value="">Anexos: todos</option>
          <option value="com" ${filters.anexo==='com'?'selected':''}>📎 Com anexos</option>
          <option value="sem" ${filters.anexo==='sem'?'selected':''}>Sem anexos</option>
        </select>
        <select id="kb-f-resp">
          <option value="">Responsável: todos</option>
          <option value="sem" ${filters.responsavel==='sem'?'selected':''}>👤 Sem responsável</option>
          ${responsaveis.length ? '<option disabled>──────────</option>' : ''}
          ${responsaveis.map(r => `<option value="${UI.escapeHtml(r.id)}" ${filters.responsavel===r.id?'selected':''}>${UI.escapeHtml(r.nome)}</option>`).join('')}
        </select>
        <button class="btn small ghost" id="kb-f-clear" style="${hasFiltro?'':'display:none'}">Limpar filtros</button>
      </div>
      <div class="kb-counter-bar">
        <div class="muted small" id="kb-counter"></div>
        ${isStaff ? '<button class="btn primary" id="kb-new">+ Novo card</button>' : ''}
      </div>
      <div class="kb-board" id="kb-board"></div>`;

    redrawBody();

    document.getElementById('kb-board').addEventListener('click', e => {
      const cd = e.target.closest('.kb-card');
      if (cd) openCardModal(cd.dataset.id);
    });
    if (isStaff) document.getElementById('kb-new').onclick = openNewCardModal;
    bindFilters();
  }

  // Re-renderiza só o board e o contador. NÃO recria a toolbar — preserva
  // foco no input de busca e estado dos selects.
  function redrawBody() {
    const visiveis = filteredCards();
    const hasFiltro = hasAnyFilter();

    const counter = document.getElementById('kb-counter');
    if (counter) {
      counter.innerHTML = `${visiveis.length} de ${cards.length} card(s)` +
        (hasFiltro ? ' • <span style="color:var(--ac)">filtros ativos</span>' : '');
    }
    const clearBtn = document.getElementById('kb-f-clear');
    if (clearBtn) clearBtn.style.display = hasFiltro ? '' : 'none';

    const board = document.getElementById('kb-board');
    if (!board) return;
    board.innerHTML = meta.stagesOrder.map(stage => {
      const stageMeta = meta.stageMeta[stage] || { label: stage };
      const list = visiveis.filter(c => c.currentStage === stage);
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
  }

  function hasAnyFilter() {
    return !!(filters.search || filters.escritorio || filters.dataIni ||
              filters.dataFim || filters.slaStatus || filters.anexo || filters.responsavel);
  }

  function bindFilters() {
    function set(key, val) {
      if (val === '' || val == null) delete filters[key];
      else filters[key] = val;
      saveFilters();
      redrawBody(); // NÃO recria toolbar — preserva foco e digitação
    }
    // Search com debounce leve. Como redrawBody não recria o input, o foco fica.
    let tmr = null;
    document.getElementById('kb-f-search')?.addEventListener('input', e => {
      clearTimeout(tmr);
      const val = e.target.value.trim();
      tmr = setTimeout(() => set('search', val), 250);
    });
    document.getElementById('kb-f-escritorio')?.addEventListener('change', e => set('escritorio', e.target.value));
    document.getElementById('kb-f-sla')?.addEventListener('change',        e => set('slaStatus',  e.target.value));
    document.getElementById('kb-f-dataini')?.addEventListener('change',    e => set('dataIni',    e.target.value));
    document.getElementById('kb-f-datafim')?.addEventListener('change',    e => set('dataFim',    e.target.value));
    document.getElementById('kb-f-anexo')?.addEventListener('change',      e => set('anexo',      e.target.value));
    document.getElementById('kb-f-resp')?.addEventListener('change',       e => set('responsavel',e.target.value));
    document.getElementById('kb-f-clear')?.addEventListener('click', () => {
      filters = {}; saveFilters();
      // Limpar SELECTs e INPUT visualmente sem destruir o DOM
      const ids = ['kb-f-search','kb-f-escritorio','kb-f-sla','kb-f-dataini','kb-f-datafim','kb-f-anexo','kb-f-resp'];
      ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      redrawBody();
    });
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
    // Mostra TODOS os clientes; os que já têm card ficam desabilitados com
    // sufixo "(já no Kanban)". Ordena disponíveis primeiro, depois alfabética.
    const cliOpts = [...clientesCache]
      .sort((a, b) => {
        const ua = usados.has(a.id), ub = usados.has(b.id);
        if (ua !== ub) return ua ? 1 : -1;
        return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
      })
      .map(c => {
        const jaTem = usados.has(c.id);
        const esc = c.escritorio ? ` -- ${UI.escapeHtml(c.escritorio)}` : '';
        const sufixo = jaTem ? ' (já no Kanban)' : '';
        return `<option value="${c.id}" ${jaTem ? 'disabled' : ''}>${UI.escapeHtml(c.nome)}${esc}${sufixo}</option>`;
      }).join('');

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
