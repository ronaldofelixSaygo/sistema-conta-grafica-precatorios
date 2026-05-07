window.AUTH = (() => {
  let me = null;

  async function tryRestore() {
    try { const r = await API.get('/api/auth/me'); me = r.user; return me; }
    catch { me = null; return null; }
  }

  async function login(email, password) {
    const r = await API.post('/api/auth/login', { email, password });
    me = r.user; return me;
  }

  async function logout() {
    try { await API.post('/api/auth/logout'); } catch {}
    me = null;
    location.reload();
  }

  function user() { return me; }
  function role() { return me?.role || null; }
  function isAdm()    { return role() === 'ADM'; }
  function isStaff()  { return role() === 'ADM' || role() === 'SAYGO'; }

  return { tryRestore, login, logout, user, role, isAdm, isStaff };
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
