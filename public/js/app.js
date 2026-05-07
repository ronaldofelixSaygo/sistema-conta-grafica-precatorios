// Bootstrap e roteamento de views.
window.APP = (() => {
  const TITLES = {
    dashboard: 'Painel',
    kanban: 'Kanban de Habilitação',
    acionamentos: 'Acionamentos',
    clientes: 'Clientes',
    movimentacoes: 'Movimentações',
    saldos: 'Saldos',
    comissoes: 'Comissões',
    relatorios: 'Relatórios',
    alertas: 'Alertas',
    parceiros: 'Parceiros',
    usuarios: 'Usuários',
    auditoria: 'Auditoria',
    parametros: 'Parâmetros',
    admin: 'Migração de Dados',
  };

  function showScreen(which) {
    document.getElementById('screen-login').classList.toggle('hidden', which !== 'login');
    document.getElementById('screen-app').classList.toggle('hidden',   which !== 'app');
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-' + name)?.classList.remove('hidden');
    document.getElementById('view-title').textContent = TITLES[name] || name;
    document.querySelectorAll('.sidebar nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.view === name);
    });
    const fn = window['VIEW_' + name]?.render;
    if (fn) fn();
  }

  function applyRoleVisibility() {
    const isAdm   = AUTH.isAdm();
    const isStaff = AUTH.isStaff();
    document.querySelectorAll('[data-admin-only]').forEach(el => el.style.display = isAdm   ? '' : 'none');
    document.querySelectorAll('[data-staff-only]').forEach(el => el.style.display = isStaff ? '' : 'none');
  }

  async function bootAfterLogin() {
    const me = AUTH.user();
    document.getElementById('me-name').textContent = me.name;
    document.getElementById('me-role').textContent = roleLabel(me.role) + (me.officeName ? ` · ${me.officeName}` : '');
    showScreen('app');
    applyRoleVisibility();
    showView('dashboard');
    CHAT.init();
    if (window.THEME) THEME.init();
  }

  function roleLabel(r) {
    return ({ ADM: 'Administrador', SAYGO: 'Usuário Saygo', PARTNER: 'Parceiro', CLIENT: 'Cliente' })[r] || r;
  }

  document.querySelectorAll('.sidebar nav a').forEach(a => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      const v = a.dataset.view;
      if (v) showView(v);
    });
  });

  async function start() {
    const me = await AUTH.tryRestore();
    if (me) await bootAfterLogin();
    else    showScreen('login');
  }

  return { start, bootAfterLogin, showView };
})();

window.addEventListener('DOMContentLoaded', () => APP.start());
