window.VIEW_parametros = (() => {
  let perms = [], permsMeta = null;
  let stageConfigs = [];
  let activeTab = 'permissoes';

  async function render() {
    const el = document.getElementById('view-parametros');
    el.innerHTML = `
      <div style="display:flex;gap:.4rem;margin-bottom:1rem;border-bottom:1px solid var(--bd)">
        <button class="btn ghost ${activeTab==='permissoes'?'primary':''}" data-tab="permissoes">Permissoes</button>
        <button class="btn ghost ${activeTab==='etapas'?'primary':''}"     data-tab="etapas">Etapas do Kanban</button>
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
        <p class="muted small" style="margin-bottom:1rem">
          Marque o que cada perfil pode fazer em cada modulo. ADM sempre tem acesso completo.
        </p>
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

  // ===== ETAPAS DO KANBAN =====
  async function loadStages() {
    const c = document.getElementById('param-content');
    c.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      stageConfigs = await API.get('/api/kanban/stage-configs');
      drawStages();
    } catch (e) { c.innerHTML = `<div class="err">${e.message}</div>`; }
  }
  function drawStages() {
    const c = document.getElementById('param-content');
    c.innerHTML = `
      <div class="panel">
        <h3>Configuracao das etapas do Kanban</h3>
        <p class="muted small" style="margin-bottom:1rem">
          Edite o rotulo, SLA (em horas), responsavel padrao e checklist de cada etapa.
          As alteracoes valem para novos cards. Cards ja criados mantem o checklist atual --
          edite-os manualmente no card se precisar.
        </p>
        ${stageConfigs.map(stageCard).join('')}
      </div>`;
    c.addEventListener('click', stageHandler);
  }
  function stageCard(s) {
    const checklist = Array.isArray(s.checklist) ? s.checklist : [];
    const items = checklist.map((item, idx) => {
      const lbl = typeof item === 'string' ? item : (item.label || '');
      return `
        <li style="display:flex;gap:.4rem;align-items:center;margin-bottom:4px">
          <input type="text" data-cl-stage="${s.stage}" data-cl-idx="${idx}" value="${UI.escapeHtml(lbl)}" style="flex:1">
          <button class="btn small ghost" data-action="rm-item" data-stage="${s.stage}" data-idx="${idx}">x</button>
        </li>`;
    }).join('');
    return `
      <div style="border:1px solid var(--bd);border-radius:var(--r);padding:.8rem 1rem;margin-bottom:.7rem">
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:.5rem">
          <div><label class="muted small">Rotulo</label>
            <input type="text" data-stage="${s.stage}" data-k="label" value="${UI.escapeHtml(s.label)}"></div>
          <div><label class="muted small">SLA (horas)</label>
            <input type="number" min="0" data-stage="${s.stage}" data-k="slaHours" value="${s.slaHours}"></div>
          <div><label class="muted small">Responsavel padrao</label>
            <select data-stage="${s.stage}" data-k="defaultResponsibleRole">
              <option value="" ${!s.defaultResponsibleRole?'selected':''}>--</option>
              <option value="SAYGO"   ${s.defaultResponsibleRole==='SAYGO'?'selected':''}>Saygo</option>
              <option value="PARTNER" ${s.defaultResponsibleRole==='PARTNER'?'selected':''}>Parceiro</option>
              <option value="CLIENT"  ${s.defaultResponsibleRole==='CLIENT'?'selected':''}>Cliente</option>
              <option value="ADM"     ${s.defaultResponsibleRole==='ADM'?'selected':''}>Adm</option>
            </select>
          </div>
        </div>
        <div style="margin-top:.6rem">
          <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Checklist</strong>
          <ul style="list-style:none;padding:0;margin:.4rem 0">${items}</ul>
          <div style="display:flex;gap:.4rem;align-items:center">
            <input type="text" id="add-${s.stage}" placeholder="Nova atividade..." style="flex:1">
            <button class="btn small" data-action="add-item" data-stage="${s.stage}">+ Adicionar</button>
          </div>
        </div>
        <div style="margin-top:.6rem">
          <button class="btn small primary" data-action="save-stage" data-stage="${s.stage}">Salvar etapa</button>
        </div>
      </div>`;
  }
  async function stageHandler(ev) {
    const a = ev.target.dataset.action;
    if (!a) return;
    const stage = ev.target.dataset.stage;
    const cfg   = stageConfigs.find(s => s.stage === stage);
    if (!cfg) return;
    if (a === 'rm-item') {
      const idx = parseInt(ev.target.dataset.idx, 10);
      cfg.checklist = (cfg.checklist || []).filter((_, i) => i !== idx);
      drawStages();
    } else if (a === 'add-item') {
      const inp = document.getElementById('add-' + stage);
      const v = inp.value.trim();
      if (!v) return;
      cfg.checklist = [...(cfg.checklist || []), v];
      inp.value = '';
      drawStages();
    } else if (a === 'save-stage') {
      // coleta valores dos campos da etapa
      const labelEl  = document.querySelector(`[data-stage="${stage}"][data-k="label"]`);
      const slaEl    = document.querySelector(`[data-stage="${stage}"][data-k="slaHours"]`);
      const respEl   = document.querySelector(`[data-stage="${stage}"][data-k="defaultResponsibleRole"]`);
      const itemEls  = document.querySelectorAll(`[data-cl-stage="${stage}"]`);
      const checklist = Array.from(itemEls).map(i => i.value.trim()).filter(Boolean);
      try {
        await API.put(`/api/kanban/stage-configs/${stage}`, {
          label: labelEl.value, slaHours: Number(slaEl.value)||0,
          defaultResponsibleRole: respEl.value || null,
          checklist,
        });
        UI.toast('Etapa salva');
        loadStages();
      } catch (e) { UI.toast(e.message, 'err'); }
    }
  }

  return { render };
})();
