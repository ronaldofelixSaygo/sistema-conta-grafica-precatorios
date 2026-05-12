// Bootstrap e roteamento de views.
window.APP = (() => {
  const TITLES = {
    dashboard: 'Painel',
    kanban: 'Kanban de Habilitação',
    acionamentos: 'Processos',
    'credit-requests': 'Solicitação de Créditos',
    desoneracoes: 'Desonerações',
    clientes: 'Clientes',
    movimentacoes: 'Movimentações',
    saldos: 'Saldos',
    comissoes: 'Comissões',
    relatorios: 'Relatórios',
    alertas: 'Alertas',
    'consulta-ncm': 'Consulta NCM',
    parceiros: 'Intervenientes Aduaneiros',
    usuarios: 'Usuários',
    auditoria: 'Auditoria',
    parametros: 'Parâmetros',
    admin: 'Migração de Dados',
  };

  function showScreen(which) {
    document.getElementById('screen-boot') ?.classList.toggle('hidden', which !== 'boot');
    document.getElementById('screen-login').classList.toggle('hidden', which !== 'login');
    document.getElementById('screen-app').classList.toggle('hidden',   which !== 'app');
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const target = document.getElementById('view-' + name);
    if (target) {
      target.classList.remove('hidden');
      // Mostra um placeholder rápido enquanto a view não carrega seus dados
      if (!target.dataset.firstRender) {
        target.innerHTML = '<div class="view-loader"><div class="boot-spinner"></div><div class="muted small">Carregando…</div></div>';
        target.dataset.firstRender = '1';
      }
    }
    document.getElementById('view-title').textContent = TITLES[name] || name;
    document.querySelectorAll('.sidebar nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.view === name);
    });
    // Sub-itens: mantém TODOS os irmãos visíveis quando qualquer um do grupo estiver ativo.
    // 1) Identifica quais "pais" devem estar expandidos: se a view atual é o próprio pai,
    //    ou se a view atual é algum sub-item, então o pai desse sub-item entra no set.
    const parentsExpanded = new Set();
    parentsExpanded.add(name); // caso a view ativa seja um pai (ex.: acionamentos)
    document.querySelectorAll('.sidebar nav a.sub-item').forEach(a => {
      if (a.dataset.view === name) parentsExpanded.add(a.dataset.parent);
    });
    // 2) Expande todos os sub-itens cujo parent está no set
    document.querySelectorAll('.sidebar nav a.sub-item').forEach(a => {
      a.classList.toggle('expanded', parentsExpanded.has(a.dataset.parent));
    });
    const fn = window['VIEW_' + name]?.render;
    if (fn) fn();
  }

  function applyRoleVisibility() {
    // Tudo agora é dirigido pelas permissões efetivas (vindas de RolePermission no banco).
    // ADM tem todos os módulos true; outros perfis dependem da configuração feita em Parâmetros.
    document.querySelectorAll('.sidebar nav a[data-view]').forEach(a => {
      const v = a.dataset.view;
      a.style.display = AUTH.canView(v) ? '' : 'none';
    });
    // Mantém os legacy attributes funcionando (fallback)
    const isAdm   = AUTH.isAdm();
    const isStaff = AUTH.isStaff();
    document.querySelectorAll('[data-admin-only]').forEach(el => {
      if (el.dataset.view) return; // ja tratado acima
      el.style.display = isAdm ? '' : 'none';
    });
    document.querySelectorAll('[data-staff-only]').forEach(el => {
      if (el.dataset.view) return;
      el.style.display = isStaff ? '' : 'none';
    });
  }

  async function bootAfterLogin() {
    const me = AUTH.user();
    document.getElementById('me-name').textContent = me.name;
    document.getElementById('me-role').textContent = roleLabel(me.role) + (me.officeName ? ` · ${me.officeName}` : '');
    showScreen('app');
    applyRoleVisibility();
    // Carrega a primeira view permitida (na ordem do menu lateral)
    const visibleViews = [...document.querySelectorAll('.sidebar nav a[data-view]')]
      .filter(a => a.style.display !== 'none')
      .map(a => a.dataset.view);
    showView(visibleViews[0] || 'dashboard');
    CHAT.init();
    if (window.THEME) THEME.init();
  }

  function roleLabel(r) {
    return ({ ADM: 'Administrador', SAYGO: 'Usuário Saygo', PARTNER: 'Interveniente', CLIENT: 'Cliente' })[r] || r;
  }

  document.querySelectorAll('.sidebar nav a').forEach(a => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      const v = a.dataset.view;
      if (v) showView(v);
    });
  });

  async function start() {
    showScreen('boot');
    // Mensagens progressivas se demorar (Render free tier dorme após inatividade)
    const msgEl = document.getElementById('boot-msg');
    const t1 = setTimeout(() => { if (msgEl) msgEl.textContent = 'Acordando o servidor (pode levar até 50s no free tier)...'; }, 4000);
    const t2 = setTimeout(() => { if (msgEl) msgEl.textContent = 'Quase lá, continuando o handshake...'; }, 15000);
    try {
      const me = await AUTH.tryRestore();
      if (me) await bootAfterLogin();
      else    showScreen('login');
    } catch {
      showScreen('login');
    } finally {
      clearTimeout(t1); clearTimeout(t2);
    }
  }

  return { start, bootAfterLogin, showView };
})();

window.addEventListener('DOMContentLoaded', () => APP.start());
