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
  function canView(mod)   { return perms?.byModule?.[mod]?.canView   ?? false; }
  function canCreate(mod) { return perms?.byModule?.[mod]?.canCreate ?? false; }
  function canEdit(mod)   { return perms?.byModule?.[mod]?.canEdit   ?? false; }
  function canDelete(mod) { return perms?.byModule?.[mod]?.canDelete ?? false; }
  function canMutate(mod) { return canCreate(mod) || canEdit(mod) || canDelete(mod); }
  function getModules() { return perms?.modules || []; }

  return {
    tryRestore, login, logout, user, role, partnerType,
    isAdm, isStaff, isPartner, isPartnerEscritorio,
    canView, canCreate, canEdit, canDelete, canMutate, getModules,
  };
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
