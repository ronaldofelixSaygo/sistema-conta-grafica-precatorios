// Gerencia tema claro/escuro. Persiste em localStorage e (quando logado) no User.themePref.
window.THEME = (() => {
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    const ic = document.getElementById('theme-icon');
    const lb = document.getElementById('theme-label');
    if (ic) ic.textContent = t === 'light' ? '☀️' : '🌙';
    if (lb) lb.textContent = t === 'light' ? 'Modo Claro' : 'Modo Escuro';
    localStorage.setItem('theme', t);
  }
  async function setAndPersist(t) {
    apply(t);
    if (window.AUTH?.user()) {
      try { await API.post('/api/auth/theme', { theme: t }); } catch {}
    }
  }
  function init() {
    // ordem: User.themePref (vindo do server) > localStorage > 'dark'
    const fromUser  = window.AUTH?.user()?.themePref;
    const stored    = localStorage.getItem('theme');
    const t = fromUser || stored || 'dark';
    apply(t);
    const btn = document.getElementById('btn-theme');
    if (btn) btn.onclick = () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      setAndPersist(cur === 'dark' ? 'light' : 'dark');
    };
  }
  // aplicar imediatamente o que tiver salvo (antes do login)
  apply(localStorage.getItem('theme') || 'dark');
  return { init, apply, setAndPersist };
})();
