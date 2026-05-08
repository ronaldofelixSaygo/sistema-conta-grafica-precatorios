window.VIEW_usuarios = (() => {
  let users = [], clientes = [], parceiros = [];
  const ROLES = [
    { v: 'ADM',     l: 'Administrador (Adm)' },
    { v: 'SAYGO',   l: 'Usuário Saygo' },
    { v: 'PARTNER', l: 'Interveniente Aduaneiro' },
    { v: 'CLIENT',  l: 'Cliente' },
  ];
  const TYPE_LABEL = { ESCRITORIO:'Escritório', ARMADOR_LOGISTICO:'Armador', OUTRO:'Outro' };

  async function render() {
    const el = document.getElementById('view-usuarios');
    el.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      [users, clientes, parceiros] = await Promise.all([
        API.get('/api/users'),
        API.get('/api/clientes').catch(() => []),
        API.get('/api/parceiros').catch(() => []),
      ]);
      el.innerHTML = `
        <div class="page-toolbar">
          <div class="muted small">${users.length} usuário(s) cadastrado(s)</div>
          <span style="flex:1"></span>
          <button class="btn primary" id="us-new">+ Novo usuário</button>
        </div>
        <div id="us-table"></div>`;
      document.getElementById('us-new').onclick = () => openForm();
      drawTable();
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  function drawTable() {
    document.getElementById('us-table').innerHTML = UI.table({
      cols: [
        { label: 'Nome',  key: 'name' },
        { label: 'Email', key: 'email' },
        { label: 'Perfil', html: true, get: r => `<strong>${r.role}</strong>` },
        { label: 'Interveniente/Tipo', html: true, get: r =>
          r.parceiro
            ? `${UI.escapeHtml(r.parceiro.nome)} <span class="pill ${r.parceiro.type||'OUTRO'}">${TYPE_LABEL[r.parceiro.type||'OUTRO']}</span>`
            : (r.officeName ? UI.escapeHtml(r.officeName) : '—')
        },
        { label: 'Cliente vinc.', html: true, get: r => r.cliente?.nome || '—' },
        { label: 'Ativo', html: true, get: r => r.active ? '✓' : '<span style="color:var(--red)">✕</span>' },
        { label: 'Último login', get: r => UI.fmtDateTime(r.lastLoginAt) },
        { label: 'Ações', html: true, get: r =>
          `<div class="actions">
            <button class="btn small" data-edit="${r.id}">Editar</button>
            <button class="btn small ${r.active?'':'primary'}" data-toggle="${r.id}">${r.active?'Desativar':'Ativar'}</button>
            <button class="btn small danger" data-del="${r.id}">×</button>
          </div>` },
      ],
      rows: users,
    });
    const t = document.getElementById('us-table');
    t.addEventListener('click', e => {
      const eid = e.target.getAttribute('data-edit');
      const did = e.target.getAttribute('data-del');
      const tid = e.target.getAttribute('data-toggle');
      if (eid) openForm(users.find(u => u.id===eid));
      if (did) removeUser(did);
      if (tid) toggleActive(users.find(u => u.id===tid));
    });
  }

  function openForm(u = {}) {
    const isNew = !u.id;
    const cliOpts = clientes.map(c => `<option value="${c.id}" ${u.clienteId===c.id?'selected':''}>${UI.escapeHtml(c.nome)}${c.escritorio?` — ${UI.escapeHtml(c.escritorio)}`:''}</option>`).join('');
    const parcOpts = parceiros.map(p => `<option value="${p.id}" ${u.parceiroId===p.id?'selected':''}>${UI.escapeHtml(p.nome)} — ${TYPE_LABEL[p.type||'OUTRO']}</option>`).join('');

    UI.openModal(isNew ? 'Novo usuário' : `Editar ${u.email}`, `
      <form id="form-us" class="form-grid">
        <div><label>Nome *</label><input name="name" required value="${UI.escapeHtml(u.name||'')}"></div>
        <div><label>E-mail *</label><input type="email" name="email" required value="${UI.escapeHtml(u.email||'')}" ${isNew?'':'disabled'}></div>
        <div><label>Perfil *</label><select name="role" required>${ROLES.map(r => `<option value="${r.v}" ${u.role===r.v?'selected':''}>${r.l}</option>`).join('')}</select></div>
        <div><label>Senha ${isNew?'*':'(deixe em branco p/ manter)'}</label><input type="password" name="password" ${isNew?'required':''} minlength="6"></div>

        <div class="full" id="row-parceiro" style="${u.role==='PARTNER'?'':'display:none'}">
          <label>Interveniente vinculado * <span class="muted small">(define o tipo: Escritório/Armador/Outro)</span></label>
          <select name="parceiroId">
            <option value="">— selecione —</option>
            ${parcOpts}
          </select>
          ${parceiros.length===0 ? '<div class="muted small" style="margin-top:.3rem">⚠ Nenhum interveniente cadastrado. Cadastre em "Intervenientes Aduaneiros" antes.</div>' : ''}
        </div>

        <div class="full" id="row-office" style="${u.role==='PARTNER'?'':'display:none'}">
          <label>Nome do escritório <span class="muted small">(igual ao campo "Escritório" dos clientes — auto se vazio usa o nome do parceiro)</span></label>
          <input name="officeName" value="${UI.escapeHtml(u.officeName||'')}">
        </div>

        <div class="full" id="row-cliente" style="${u.role==='CLIENT'?'':'display:none'}">
          <label>Cliente vinculado *</label>
          <select name="clienteId"><option value="">—</option>${cliOpts}</select>
        </div>

        <div class="full"><label><input type="checkbox" name="active" ${u.active!==false?'checked':''}> Ativo</label></div>
        <div class="full form-actions">
          <button type="button" class="btn" id="us-cancel">Cancelar</button>
          <button type="submit" class="btn primary">Salvar</button>
        </div>
      </form>`);

    const form = document.getElementById('form-us');
    document.getElementById('us-cancel').onclick = UI.closeModal;
    form.role.onchange = (e) => {
      document.getElementById('row-parceiro').style.display = e.target.value==='PARTNER' ? '' : 'none';
      document.getElementById('row-office').style.display   = e.target.value==='PARTNER' ? '' : 'none';
      document.getElementById('row-cliente').style.display  = e.target.value==='CLIENT'  ? '' : 'none';
    };
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      data.active = !!fd.get('active');
      if (!data.password) delete data.password;
      try {
        if (isNew) await API.post('/api/users', data);
        else       await API.put(`/api/users/${u.id}`, data);
        UI.toast('Usuário salvo'); UI.closeModal(); render();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  async function removeUser(id) {
    if (!confirm('Excluir definitivamente esse usuário?')) return;
    try { await API.del(`/api/users/${id}`); UI.toast('Excluído'); render(); }
    catch (e) { UI.toast(e.message, 'err'); }
  }
  async function toggleActive(u) {
    try {
      if (u.active) await API.post(`/api/users/${u.id}/deactivate`);
      else          await API.put(`/api/users/${u.id}`, { active: true });
      UI.toast(u.active?'Desativado':'Ativado'); render();
    } catch (e) { UI.toast(e.message, 'err'); }
  }

  return { render };
})();
