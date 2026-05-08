window.AUTH = (() => {
  let me = null;
  let perms = { modules: [] };

  async function tryRestore() {
    try {
      const r = await API.get('/api/auth/me');
      me = r.user; perms = r.perms || { modules: [] };
      return me;
    } catch { me = null; perms = { modules: [] }; return null; }
  }

  async function login(email, password) {
    const r = await API.post('/api/auth/login', { email, password });
    me = r.user;
    // recarrega permissoes
    try { const m = await API.get('/api/auth/me'); perms = m.perms || { modules: [] }; } catch {}
    return me;
  }

  async function logout() {
    try { await API.post('/api/auth/logout'); } catch {}
    me = null; perms = { modules: [] };
    location.reload();
  }

  function user() { return me; }
  function role() { return me?.role || null; }
  function partnerType() { return me?.partnerType || null; }
  function isAdm()    { return role() === 'ADM'; }
  function isStaff()  { return role() === 'ADM' || role() === 'SAYGO'; }
  function isPartner(){ return role() === 'PARTNER'; }
  function isPartnerEscritorio() { return isPartner() && partnerType() === 'ESCRITORIO'; }
  function canView(mod) { return perms.modules?.includes(mod) ?? false; }
  // Igual ao backend canMutate: ADM, SAYGO ou PARTNER ESCRITORIO podem mutar nas areas onde tem acesso.
  function canMutate(mod) {
    if (!me) return false;
    if (me.role === 'ADM') return true;
    if (me.role === 'SAYGO') return ['clientes','movimentacoes','kanban','acionamentos','parceiros','comissoes'].includes(mod);
    if (me.role === 'PARTNER') {
      if (partnerType() === 'ESCRITORIO') return ['clientes','movimentacoes','kanban','acionamentos','comissoes'].includes(mod);
      return ['kanban'].includes(mod);
    }
    if (me.role === 'CLIENT') return ['acionamentos'].includes(mod);
    return false;
  }

  return { tryRestore, login, logout, user, role, partnerType, isAdm, isStaff, isPartner, isPartnerEscritorio, canView, canMutate };
})();

// Login form
document.getElementById('form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = document.getElementById('li-email').value.trim();
  const pwd   = document.getElementById('li-pwd').value;
  const errEl = document.getElementById('li-err');
  errEl.textContent = '';
  try {
    await AUTH.login(email, pwd);
    window.APP.bootAfterLogin();
  } catch (e) {
    errEl.textContent = e.message || 'Falha ao entrar';
  }
});

document.getElementById('btn-logout').addEventListener('click', () => AUTH.logout());
