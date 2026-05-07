window.VIEW_parametros = (() => {
  let perms = [], permsMeta = null;
  let stages = [];
  let activeTab = 'permissoes';

  async function render() {
    const el = document.getElementById('view-parametros');
    el.innerHTML = `
      <div style="display:flex;gap:.4rem;margin-bottom:1rem;border-bottom:1px solid var(--bd);padding-bottom:.5rem">
        <button class="btn ${activeTab==='permissoes'?'primary':''}" data-tab="permissoes">Permissoes</button>
        <button class="btn ${activeTab==='etapas'?'primary':''}"     data-tab="etapas">Etapas e Atividades</button>
      </div>
      <div id="param-content"></div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { activeTab = b.dataset.tab; render(); });
    if (activeTab === 'permissoes') return loadPerms();
    return loadStages();
  }

  // ===== PERMISSOES =====
  async function loadPerms() {
    const c = document.getElementById('param-content');
    c.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      const r = await API.get('/api/permissions');
      perms = r.items; permsMeta = r.meta;
      drawPerms();
    } catch (e) { c.innerHTML = `<div class="err">${e.message}</div>`; }
  }
  function drawPerms() {
    const c = document.getElementById('param-content');
    const moduleLabels = {
      dashboard:'Painel', clientes:'Clientes', movimentacoes:'Movimentacoes',
      saldos:'Saldos', comissoes:'Comissoes', relatorios:'Relatorios',
      alertas:'Alertas', kanban:'Kanban', acionamentos:'Acionamentos',
      parceiros:'Parceiros', usuarios:'Usuarios', auditoria:'Auditoria',
      migracao:'Migracao', chat:'Chat', parametros:'Parametros',
    };
    const roleLabels = { ADM:'Administrador', SAYGO:'Saygo', PARTNER:'Parceiro', CLIENT:'Cliente' };
    c.innerHTML = `
      <div class="panel">
        <h3>Matriz de permissoes por perfil</h3>
        <p class="muted small" style="margin-bottom:1rem">Marque o que cada perfil pode fazer em cada modulo.</p>
        <div style="overflow-x:auto">
          <table class="table">
            <thead>
              <tr>
                <th>Modulo</th>
                ${permsMeta.ROLES.map(r => `<th colspan="4" style="text-align:center;border-left:1px solid var(--bd2)">${roleLabels[r]||r}</th>`).join('')}
              </tr>
              <tr>
                <th></th>
                ${permsMeta.ROLES.map(() => `
                  <th style="font-size:9px;border-left:1px solid var(--bd2)">VER</th>
                  <th style="font-size:9px">CRIAR</th>
                  <th style="font-size:9px">EDIT</th>
                  <th style="font-size:9px">EXCL</th>
                `).join('')}
              </tr>
            </thead>
            <tbody>
              ${permsMeta.MODULES.map(mod => {
                const cells = permsMeta.ROLES.map(role => {
                  const p = perms.find(x => x.role===role && x.module===mod);
                  if (!p) return '<td>--</td>'.repeat(4);
                  const cb = (k) => `<input type="checkbox" data-pid="${p.id}" data-k="${k}" ${p[k]?'checked':''} ${role==='ADM'?'disabled':''}>`;
                  return `
                    <td style="text-align:center;border-left:1px solid var(--bd2)">${cb('canView')}</td>
                    <td style="text-align:center">${cb('canCreate')}</td>
                    <td style="text-align:center">${cb('canEdit')}</td>
                    <td style="text-align:center">${cb('canDelete')}</td>`;
                }).join('');
                return `<tr><td><strong>${moduleLabels[mod]||mod}</strong></td>${cells}</tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:1rem;display:flex;gap:.5rem">
          <button class="btn primary" id="pe-save">Salvar alteracoes</button>
          <button class="btn" id="pe-reset">Restaurar padroes</button>
        </div>
      </div>
    `;
    document.getElementById('pe-save').onclick = savePerms;
    document.getElementById('pe-reset').onclick = async () => {
      if (!confirm('Restaurar permissoes padrao?')) return;
      try { await API.post('/api/permissions/reset'); UI.toast('Restaurado'); loadPerms(); }
      catch (e) { UI.toast(e.message, 'err'); }
    };
  }
  async function savePerms() {
    const checks = document.querySelectorAll('[data-pid]');
    const byPid = {};
    checks.forEach(c => {
      byPid[c.dataset.pid] = byPid[c.dataset.pid] || {};
      byPid[c.dataset.pid][c.dataset.k] = c.checked;
    });
    let ok=0, fail=0;
    for (const [pid, body] of Object.entries(byPid)) {
      try { await API.put(`/api/permissions/${pid}`, body); ok++; } catch { fail++; }
    }
    UI.toast(`${ok} salvo${fail?`, ${fail} falha(s)`:''}`, fail?'err':'ok');
  }

  // ===== ETAPAS E ATIVIDADES =====
  async function loadStages() {
    const c = document.getElementById('param-content');
    c.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      stages = await API.get('/api/kanban/stages');
      drawStages();
    } catch (e) { c.innerHTML = `<div class="err">${e.message}</div>`; }
  }
  function drawStages() {
    const c = document.getElementById('param-content');
    c.innerHTML = `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
          <h3>Etapas e atividades do Kanban</h3>
          <button class="btn primary" id="add-stage">+ Nova etapa</button>
        </div>
        <p class="muted small" style="margin-bottom:1rem">
          Etapas inativas nao aparecem no Kanban. Atividades inativas tambem ficam ocultas em novos cards.
          Excluir uma etapa so e possivel se nao houver cards usando ela.
        </p>
        ${stages.map(stageCard).join('')}
      </div>`;
    document.getElementById('add-stage').onclick = () => openStageForm();
    c.addEventListener('click', stageHandler);
  }
  function stageCard(s) {
    const acts = (s.activities || []).map(a => `
      <li class="param-act ${a.active?'':'inactive'}">
        <input type="text" data-act-edit="${a.id}" value="${UI.escapeHtml(a.label)}">
        <button class="btn small" data-act-save="${a.id}">Salvar</button>
        <button class="btn small ${a.active?'':'primary'}" data-act-toggle="${a.id}" data-active="${a.active}">${a.active?'Desativar':'Ativar'}</button>
        <button class="btn small danger" data-act-del="${a.id}">x</button>
      </li>`).join('');
    return `
      <div class="param-stage ${s.active?'':'inactive'}">
        <div class="param-stage-head">
          <div>
            <span class="param-stage-order">${s.order}</span>
            <strong>${UI.escapeHtml(s.label)}</strong>
            <span class="muted small" style="margin-left:.4rem">[${s.key}]</span>
            ${s.isFinal?'<span class="badge-final">FINAL</span>':''}
            ${s.active?'':'<span class="badge-inactive">INATIVA</span>'}
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap">
            <button class="btn small" data-stage-edit="${s.id}">Editar</button>
            <button class="btn small ${s.active?'':'primary'}" data-stage-toggle="${s.id}" data-active="${s.active}">${s.active?'Desativar':'Ativar'}</button>
            <button class="btn small danger" data-stage-del="${s.id}">Excluir</button>
          </div>
        </div>
        <div class="muted small" style="margin:.3rem 0 .6rem">
          SLA: ${s.slaHours}h * Responsavel padrao: ${s.defaultResponsibleRole || '--'}
        </div>
        <ul class="param-act-list">${acts}</ul>
        <div class="param-act-add">
          <input type="text" id="add-act-${s.id}" placeholder="Nova atividade...">
          <button class="btn small primary" data-act-add="${s.id}">+ Adicionar atividade</button>
        </div>
      </div>`;
  }
  function openStageForm(stage = null) {
    const isNew = !stage;
    UI.openModal(isNew ? 'Nova etapa' : `Editar etapa "${stage.label}"`, `
      <form id="form-stg" class="form-grid">
        <div class="full"><label>Nome (label) *</label><input name="label" required value="${UI.escapeHtml(stage?.label||'')}"></div>
        ${isNew ? '<div class="full"><label>Chave (auto, opcional)</label><input name="key" placeholder="Ex: ONBOARDING (deixar vazio gera automaticamente)"></div>' : ''}
        <div><label>Ordem</label><input type="number" name="order" value="${stage?.order ?? 0}"></div>
        <div><label>SLA (horas)</label><input type="number" min="0" name="slaHours" value="${stage?.slaHours ?? 72}"></div>
        <div class="full"><label>Responsavel padrao</label>
          <select name="defaultResponsibleRole">
            <option value=""        ${!stage?.defaultResponsibleRole?'selected':''}>--</option>
            <option value="SAYGO"   ${stage?.defaultResponsibleRole==='SAYGO'?'selected':''}>Saygo</option>
            <option value="PARTNER" ${stage?.defaultResponsibleRole==='PARTNER'?'selected':''}>Parceiro</option>
            <option value="CLIENT"  ${stage?.defaultResponsibleRole==='CLIENT'?'selected':''}>Cliente</option>
            <option value="ADM"     ${stage?.defaultResponsibleRole==='ADM'?'selected':''}>Adm</option>
          </select>
        </div>
        <div class="full"><label><input type="checkbox" name="isFinal" ${stage?.isFinal?'checked':''}> Etapa final (Concluido)</label></div>
        <div class="full"><label><input type="checkbox" name="active" ${stage===null||stage.active?'checked':''}> Ativa</label></div>
        <div class="full form-actions">
          <button type="button" class="btn" id="stg-cancel">Cancelar</button>
          <button type="submit" class="btn primary">Salvar</button>
        </div>
      </form>`);
    document.getElementById('stg-cancel').onclick = UI.closeModal;
    document.getElementById('form-stg').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const data = {
        label: fd.get('label'),
        key:   fd.get('key') || undefined,
        order: Number(fd.get('order')) || 0,
        slaHours: Number(fd.get('slaHours')) || 72,
        defaultResponsibleRole: fd.get('defaultResponsibleRole') || null,
        isFinal: !!fd.get('isFinal'),
        active:  !!fd.get('active'),
      };
      try {
        if (isNew) await API.post('/api/kanban/stages', data);
        else       await API.put(`/api/kanban/stages/${stage.id}`, data);
        UI.toast('Etapa salva'); UI.closeModal(); loadStages();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }
  async function stageHandler(ev) {
    const t = ev.target;
    const id = t.dataset.stageEdit || t.dataset.stageDel || t.dataset.stageToggle
            || t.dataset.actAdd || t.dataset.actSave || t.dataset.actDel || t.dataset.actToggle;
    if (!id) return;
    if (t.dataset.stageEdit) {
      const s = stages.find(x => x.id === id);
      openStageForm(s);
    } else if (t.dataset.stageDel) {
      if (!confirm('Excluir essa etapa? So funciona se nao houver cards usando.')) return;
      try { await API.del(`/api/kanban/stages/${id}`); UI.toast('Etapa excluida'); loadStages(); }
      catch (e) { UI.toast(e.message, 'err'); }
    } else if (t.dataset.stageToggle) {
      const isActive = t.dataset.active === 'true';
      try {
        await API.put(`/api/kanban/stages/${id}`, { active: !isActive });
        UI.toast(isActive ? 'Inativada' : 'Ativada'); loadStages();
      } catch (e) { UI.toast(e.message, 'err'); }
    } else if (t.dataset.actAdd) {
      const inp = document.getElementById('add-act-' + id);
      const label = inp.value.trim();
      if (!label) return;
      try {
        await API.post(`/api/kanban/stages/${id}/activities`, { label });
        UI.toast('Atividade adicionada'); loadStages();
      } catch (e) { UI.toast(e.message, 'err'); }
    } else if (t.dataset.actSave) {
      const inp = document.querySelector(`[data-act-edit="${id}"]`);
      const label = inp.value.trim();
      try { await API.put(`/api/kanban/activities/${id}`, { label }); UI.toast('Atividade atualizada'); loadStages(); }
      catch (e) { UI.toast(e.message, 'err'); }
    } else if (t.dataset.actDel) {
      if (!confirm('Excluir essa atividade?')) return;
      try { await API.del(`/api/kanban/activities/${id}`); UI.toast('Atividade excluida'); loadStages(); }
      catch (e) { UI.toast(e.message, 'err'); }
    } else if (t.dataset.actToggle) {
      const isActive = t.dataset.active === 'true';
      try {
        await API.put(`/api/kanban/activities/${id}`, { active: !isActive });
        UI.toast(isActive ? 'Inativada' : 'Ativada'); loadStages();
      } catch (e) { UI.toast(e.message, 'err'); }
    }
  }

  return { render };
})();
