window.VIEW_comissoes = (() => {
  let activeTab = 'simulacao';
  let escritoriosCache = null;

  async function loadEscritorios() {
    if (escritoriosCache) return escritoriosCache;
    try {
      const list = await API.get('/api/comissoes/escritorios', null, { ttl: 60000 });
      escritoriosCache = (list || []).filter(Boolean);
      return escritoriosCache;
    } catch { escritoriosCache = []; return []; }
  }

  async function render() {
    const el = document.getElementById('view-comissoes');
    const isStaff = AUTH.isStaff();
    const isPartnerEsc = AUTH.isPartnerEscritorio();

    el.innerHTML = `
      <div style="display:flex;gap:.4rem;margin-bottom:1rem;border-bottom:1px solid var(--bd);padding-bottom:.5rem">
        <button class="btn ${activeTab==='simulacao'?'primary':''}" data-tab="simulacao">Simulação</button>
        ${(isStaff || isPartnerEsc) ? `<button class="btn ${activeTab==='apuracao'?'primary':''}" data-tab="apuracao">Apuração</button>` : ''}
      </div>
      <div id="com-content"></div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { activeTab = b.dataset.tab; render(); });
    if (activeTab === 'simulacao') return loadSim();
    return loadApu();
  }

  // ===== SIMULAÇÃO =====
  async function loadSim() {
    const c = document.getElementById('com-content');
    const isStaff = AUTH.isStaff();

    // Para PARTNER, o parceiro é ele mesmo — não exibe campo
    let parcInput = '';
    if (isStaff) {
      const ps = await loadEscritorios();
      parcInput = `
        <select id="sim-parc">
          <option value="">Todos os parceiros</option>
          ${ps.map(p => `<option value="${UI.escapeHtml(p)}">${UI.escapeHtml(p)}</option>`).join('')}
        </select>`;
    }

    c.innerHTML = `
      <div class="page-toolbar">
        ${parcInput}
        <input id="sim-mes"  placeholder="MM" maxlength="2" style="max-width:80px" />
        <input id="sim-ano"  placeholder="AAAA" maxlength="4" style="max-width:100px" />
        <button class="btn primary" id="sim-go">Simular Comissões</button>
      </div>
      <div id="sim-list"></div>`;
    document.getElementById('sim-go').onclick = simulate;
  }
  async function simulate() {
    const isStaff = AUTH.isStaff();
    const q = {
      mes: val('sim-mes'), ano: val('sim-ano'),
    };
    if (isStaff) {
      const esc = val('sim-parc');
      if (esc) q.escritorio = esc;
    }
    const out = document.getElementById('sim-list');
    out.innerHTML = '<div class="muted">Calculando...</div>';
    try {
      const rows = await API.get('/api/comissoes/simulate', q);
      if (!rows.length) {
        out.innerHTML = '<div class="muted small" style="padding:1rem">Sem comissões no período.</div>';
        return;
      }
      out.innerHTML = rows.map(r => {
        const hasDi = (r.total_comissao_di || 0) > 0;
        const hasCred = (r.total_comissao_credito || 0) > 0;
        const detCred = (r.detalhes || []).filter(x => (x.valor_comissao || 0) > 0);
        const detDi   = (r.detalhes || []).filter(x => (x.valor_comissao_di || 0) > 0);
        return `
        <div class="panel">
          <h3>${UI.escapeHtml(r.parceiro)} — ${UI.escapeHtml(r.mes_ano)}
            <span style="float:right;color:var(--green)">${UI.fmtMoney(r.total_comissao)}</span></h3>
          <div class="muted small" style="margin-bottom:.5rem">
            ${hasCred ? `Créditos: <strong>${UI.fmtMoney(r.total_comissao_credito||0)}</strong>` : ''}
            ${hasCred && hasDi ? ' · ' : ''}
            ${hasDi ? `DI/Duimp: <strong>${UI.fmtMoney(r.total_comissao_di||0)}</strong>` : ''}
          </div>
          ${hasCred ? `
            <h4 style="margin:.6rem 0 .3rem;font-size:13px">Comissão sobre créditos</h4>
            ${UI.table({
              cols: [
                { label: 'Cliente', key: 'cliente_nome' },
                { label: 'Período', get: x => `${UI.fmtDate(x.periodo_inicio)} → ${UI.fmtDate(x.periodo_fim)}` },
                { label: 'Créditos', align: 'right', get: x => UI.fmtMoney(x.total_creditos) },
                { label: '%', align: 'right', get: x => `${x.percentual}%` },
                { label: 'Comissão', align: 'right', get: x => UI.fmtMoney(x.valor_comissao) },
              ],
              rows: detCred,
            })}` : ''}
          ${hasDi ? `
            <h4 style="margin:.8rem 0 .3rem;font-size:13px">Comissão por DI/Duimp</h4>
            ${UI.table({
              cols: [
                { label: 'Cliente', key: 'cliente_nome' },
                { label: 'Período', get: x => `${UI.fmtDate(x.periodo_inicio)} → ${UI.fmtDate(x.periodo_fim)}` },
                { label: 'DIs únicas', align: 'right', get: x => x.total_dis || 0 },
                { label: 'Valor/DI', align: 'right', get: x => UI.fmtMoney(x.valor_por_di) },
                { label: 'Comissão DI', align: 'right', get: x => UI.fmtMoney(x.valor_comissao_di) },
              ],
              rows: detDi,
            })}` : ''}
        </div>`;
      }).join('');
    } catch (e) {
      out.innerHTML = `<div class="err">${e.message}</div>`;
    }
  }

  // ===== APURAÇÃO =====
  async function loadApu() {
    const c = document.getElementById('com-content');
    c.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      const list = await API.get('/api/comissoes');
      const isStaff = AUTH.isStaff();
      const isPartnerEsc = AUTH.isPartnerEscritorio();

      // PARTNER ESCRITORIO gera pro próprio escritório.
      // ADM/SAYGO podem gerar pra qualquer escritório (escolhe no modal).
      const canCreate = isPartnerEsc || isStaff;
      const action = canCreate
        ? `<button class="btn primary" id="ap-new">+ Nova apuração</button>`
        : '';
      c.innerHTML = `
        <div class="page-toolbar">
          <div class="muted small">${list.length} apuração(ões)</div>
          <span style="flex:1"></span>
          ${action}
        </div>
        <div id="ap-list"></div>`;
      drawApuList(list);
      if (canCreate) document.getElementById('ap-new').onclick = openNewApu;
    } catch (e) { c.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  function statusPill(s) {
    const colors = {
      DRAFT:'amber', SUBMITTED:'blue', APPROVED:'green', REJECTED:'red', CLOSED:'green',
    };
    return `<span class="pill ${colors[s]||'amber'}">${s}</span>`;
  }

  function drawApuList(list) {
    const out = document.getElementById('ap-list');
    if (!list.length) { out.innerHTML = '<div class="muted small" style="padding:1rem">Sem apurações ainda.</div>'; return; }
    out.innerHTML = UI.table({
      cols: [
        { label: 'Mês/Ref', key: 'monthRef' },
        { label: 'Interveniente', get: r => r.parceiro?.nome },
        { label: 'Base', align:'right', get: r => UI.fmtMoney(r.totalBase) },
        { label: 'Extras', align:'right', get: r => UI.fmtMoney(r.totalExtras) },
        { label: 'Total', align:'right', html: true, get: r => `<strong>${UI.fmtMoney(r.totalFinal)}</strong>` },
        { label: 'Status', html: true, get: r => statusPill(r.status) },
        { label: 'Ações', html: true, get: r => `<button class="btn small" data-open="${r.id}">Abrir</button>` },
      ],
      rows: list,
    });
    out.onclick = e => {
      const id = e.target.getAttribute('data-open');
      if (id) openDetail(list.find(x => x.id===id));
    };
  }

  async function openNewApu() {
    const me = AUTH.user();
    const isStaff = AUTH.isStaff();
    const isPartnerEsc = AUTH.isPartnerEscritorio();
    const meEsc = me?.officeName || me?.parceiroNome || '';

    // Admin escolhe o escritório; partner usa o próprio
    let escField = '';
    if (isPartnerEsc) {
      escField = `<input value="${UI.escapeHtml(meEsc || '— seu escritório vinculado —')}" readonly>`;
    } else if (isStaff) {
      const ps = await loadEscritorios();
      escField = `
        <select name="escritorio" required>
          <option value="">— selecione —</option>
          ${ps.map(p => `<option value="${UI.escapeHtml(p)}">${UI.escapeHtml(p)}</option>`).join('')}
        </select>`;
    }

    UI.openModal('Nova apuração de comissão', `
      <form id="form-apu" class="form-grid">
        <div class="full"><label>Interveniente / Escritório${isStaff ? ' *' : ''}</label>
          ${escField}
        </div>
        <div class="full"><label>Mês de referência (YYYY-MM) *</label>
          <input name="monthRef" required placeholder="2026-05" pattern="\\d{4}-\\d{2}">
        </div>
        <div class="full muted small">
          Não é possível gerar mais de uma apuração para o mesmo mês/ano. Para refazer, exclua a anterior enquanto ela estiver em rascunho ou rejeitada.
        </div>
        <div class="full form-actions">
          <button type="button" class="btn" id="apu-cancel">Cancelar</button>
          <button type="submit" class="btn primary">Gerar Apuração</button>
        </div>
      </form>`);
    document.getElementById('apu-cancel').onclick = UI.closeModal;
    document.getElementById('form-apu').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const payload = { monthRef: fd.get('monthRef') };
      if (isStaff && !isPartnerEsc) payload.escritorio = fd.get('escritorio');
      try {
        await API.post('/api/comissoes', payload);
        UI.toast('Apuração gerada'); UI.closeModal(); render();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  function openDetail(c) {
    const isStaff = AUTH.isStaff();
    const me = AUTH.user();
    // Owner = PARTNER ESCRITORIO cujo parceiro vinculado tem o mesmo nome do parceiro da Commission
    // (cobre o caso onde o auto-create gerou um Parceiro novo com mesmo nome)
    const isOwner = AUTH.isPartnerEscritorio() && (
      me?.parceiroId === c.parceiroId ||
      (c.parceiro?.nome && (me?.officeName === c.parceiro.nome || me?.parceiroNome === c.parceiro.nome))
    );
    const editable = (c.status === 'DRAFT' || c.status === 'REJECTED') && isOwner;
    const detalhes = Array.isArray(c.detalhes) ? c.detalhes : [];
    const detCred = detalhes.filter(x => (x.valor_comissao || 0) > 0);
    const detDi   = detalhes.filter(x => (x.valor_comissao_di || 0) > 0);

    let html = `
      <div class="muted small" style="margin-bottom:.4rem">
        Mês ${c.monthRef} — ${UI.escapeHtml(c.parceiro?.nome || '')}
        ${statusPill(c.status)}
        ${c.rejectReason ? `<div class="err small" style="margin-top:.4rem">Motivo da rejeição: ${UI.escapeHtml(c.rejectReason)}</div>` : ''}
      </div>
      ${detCred.length ? `
      <div class="panel">
        <h3>Comissão sobre créditos <span style="float:right;color:var(--green)">${UI.fmtMoney(c.totalBaseCredito ?? c.totalBase ?? 0)}</span></h3>
        ${UI.table({
          cols: [
            { label: 'Cliente', key: 'cliente_nome' },
            { label: 'Período', get: x => `${UI.fmtDate(x.periodo_inicio)} → ${UI.fmtDate(x.periodo_fim)}` },
            { label: 'Créditos', align:'right', get: x => UI.fmtMoney(x.total_creditos) },
            { label: '%', align:'right', get: x => `${x.percentual}%` },
            { label: 'Comissão', align:'right', get: x => UI.fmtMoney(x.valor_comissao) },
          ], rows: detCred,
        })}
      </div>` : ''}
      ${detDi.length ? `
      <div class="panel">
        <h3>Comissão por DI/Duimp <span style="float:right;color:var(--green)">${UI.fmtMoney(c.totalBaseDi ?? 0)}</span></h3>
        ${UI.table({
          cols: [
            { label: 'Cliente', key: 'cliente_nome' },
            { label: 'Período', get: x => `${UI.fmtDate(x.periodo_inicio)} → ${UI.fmtDate(x.periodo_fim)}` },
            { label: 'DIs únicas', align:'right', get: x => x.total_dis || 0 },
            { label: 'Valor/DI', align:'right', get: x => UI.fmtMoney(x.valor_por_di) },
            { label: 'Comissão DI', align:'right', get: x => UI.fmtMoney(x.valor_comissao_di) },
          ], rows: detDi,
        })}
      </div>` : ''}
      <div class="panel">
        <h3>Lançamentos extras (adições/reduções)</h3>
        ${UI.table({
          cols: [
            { label: 'Descrição', key: 'description' },
            { label: 'Valor', align:'right', html: true, get: x => `<span class="${x.amount<0?'val-neg':'val-pos'}">${UI.fmtMoney(x.amount)}</span>` },
            { label: '', html: true, get: x => editable ? `<button class="btn small danger" data-rm-ext="${x.id}">x</button>` : '' },
          ],
          rows: c.extras || [],
          empty: 'Sem extras.',
        })}
        ${editable ? `
          <div style="display:grid;grid-template-columns:2fr 1fr auto;gap:.4rem;margin-top:.5rem">
            <input id="ext-desc" placeholder="Descrição">
            <input id="ext-val" type="number" step="0.01" placeholder="Valor (use - para redução)">
            <button class="btn primary" id="ext-add">Adicionar</button>
          </div>` : ''}
      </div>
      <div class="panel">
        <table class="table"><tbody>
          ${(c.totalBaseCredito||0) > 0 ? `<tr><td>Base (créditos)</td><td class="num">${UI.fmtMoney(c.totalBaseCredito)}</td></tr>` : ''}
          ${(c.totalBaseDi||0) > 0 ? `<tr><td>Base (DI/Duimp)</td><td class="num">${UI.fmtMoney(c.totalBaseDi)}</td></tr>` : ''}
          <tr><td><strong>Subtotal base</strong></td><td class="num"><strong>${UI.fmtMoney(c.totalBase)}</strong></td></tr>
          <tr><td>Extras</td><td class="num">${UI.fmtMoney(c.totalExtras)}</td></tr>
          <tr><td><strong>Total final</strong></td><td class="num"><strong>${UI.fmtMoney(c.totalFinal)}</strong></td></tr>
        </tbody></table>
      </div>`;

    // Botões de ação
    const btns = [];
    if (isOwner && editable) {
      btns.push(`<button class="btn" id="apu-recalc" data-id="${c.id}">Recalcular</button>`);
      btns.push(`<button class="btn danger" id="apu-delete" data-id="${c.id}">Excluir apuração</button>`);
      if (c.status === 'DRAFT' || c.status === 'REJECTED') {
        btns.push(`<button class="btn primary" id="apu-submit" data-id="${c.id}">Enviar para revisão</button>`);
      }
    }
    if (isStaff && c.status === 'SUBMITTED') {
      btns.push(`<button class="btn primary" id="apu-approve" data-id="${c.id}">Aceitar</button>`);
      btns.push(`<button class="btn danger" id="apu-reject" data-id="${c.id}">Rejeitar</button>`);
    }
    if (isStaff && c.status === 'APPROVED') {
      btns.push(`<button class="btn primary" id="apu-close" data-id="${c.id}">Fechar definitivamente</button>`);
    }
    html += `<div class="form-actions">${btns.join('')}</div>`;

    UI.openModal(`Apuração ${c.monthRef}`, html);

    // Bind events
    // IMPORTANTE: usar onclick (sobrescreve) em vez de addEventListener (empilha) —
    // assim ao reabrir o modal não criamos handlers duplicados que multiplicavam o "ext-add"
    const body = document.getElementById('modal-body');
    let busy = false;
    body.onclick = async ev => {
      if (busy) return;
      const t = ev.target;
      try {
        if (t.dataset.rmExt) {
          if (!confirm('Excluir extra?')) return;
          busy = true;
          await API.del(`/api/comissoes/extras/${t.dataset.rmExt}`);
          reopen(c.id);
        } else if (t.id === 'ext-add') {
          const desc = document.getElementById('ext-desc').value.trim();
          const val  = Number(document.getElementById('ext-val').value);
          if (!desc) return UI.toast('Informe a descrição','err');
          busy = true;
          await API.post(`/api/comissoes/${c.id}/extras`, { description: desc, amount: val });
          reopen(c.id);
        } else if (t.id === 'apu-recalc') {
          busy = true;
          await API.post('/api/comissoes', { monthRef: c.monthRef });
          UI.toast('Recalculado');
          reopen(c.id);
        } else if (t.id === 'apu-delete') {
          if (!confirm('Excluir esta apuração? Você poderá gerar uma nova depois.')) return;
          busy = true;
          await API.del(`/api/comissoes/${c.id}`);
          UI.toast('Apuração excluída'); UI.closeModal(); render();
        } else if (t.id === 'apu-submit') {
          busy = true;
          await API.post(`/api/comissoes/${c.id}/submit`);
          UI.toast('Enviada'); UI.closeModal(); render();
        } else if (t.id === 'apu-approve') {
          busy = true;
          await API.post(`/api/comissoes/${c.id}/approve`);
          UI.toast('Aceita'); UI.closeModal(); render();
        } else if (t.id === 'apu-reject') {
          const reason = prompt('Motivo da rejeição:');
          if (!reason) return;
          busy = true;
          await API.post(`/api/comissoes/${c.id}/reject`, { reason });
          UI.toast('Rejeitada'); UI.closeModal(); render();
        } else if (t.id === 'apu-close') {
          if (!confirm('Fechar definitivamente? Não poderá mais ser alterada.')) return;
          busy = true;
          await API.post(`/api/comissoes/${c.id}/close`);
          UI.toast('Fechada'); UI.closeModal(); render();
        }
      } catch (e) {
        UI.toast(e.message, 'err');
      } finally {
        busy = false;
      }
    };
  }
  async function reopen(id) {
    try {
      const list = await API.get('/api/comissoes');
      const c = list.find(x => x.id === id);
      if (c) openDetail(c);
    } catch {}
  }

  const val = id => document.getElementById(id)?.value || '';
  return { render };
})();
