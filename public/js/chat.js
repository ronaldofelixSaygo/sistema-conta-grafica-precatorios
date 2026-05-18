window.CHAT = (() => {
  let socket = null;
  let contacts = [];
  let conversations = [];
  let openWith = null;       // userId aberto
  let unreadByUser = {};
  let onlineUsers = new Set();

  const panel    = document.getElementById('chat-panel');
  const btn      = document.getElementById('btn-chat-toggle');
  const closeBtn = document.getElementById('chat-close');
  const badge    = document.getElementById('chat-badge');

  btn.addEventListener('click', async () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      await loadContacts();
      // Se tem conversa pendente, abre direto nela
      if (lastSenderId && unreadByUser[lastSenderId]) openThread(lastSenderId);
      else renderListView();
    }
  });
  closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

  let lastSenderId = null;

  // ── inicia socket ─────────────────────────────────────────────────
  async function init() {
    if (socket) {
      try { socket.disconnect(); } catch {}
      socket = null;
    }
    const token = AUTH.getToken?.();
    socket = io('/', {
      withCredentials: true,
      auth: token ? { token } : {},
      transports: ['websocket', 'polling'],
      reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1500,
    });

    socket.on('connect',       () => console.log('[chat] conectado'));
    socket.on('disconnect',    r  => console.log('[chat] desconectado:', r));
    socket.on('connect_error', e  => console.error('[chat] connect_error:', e?.message));

    socket.on('chat:message', onIncoming);
    socket.on('chat:presence', ({ userId, online }) => {
      if (online) onlineUsers.add(userId); else onlineUsers.delete(userId);
      if (!panel.classList.contains('hidden')) renderListView();
    });

    refreshUnread();
    setInterval(refreshUnread, 60_000);
  }

  // ── nova mensagem chega ───────────────────────────────────────────
  function onIncoming(msg) {
    const me = AUTH.user();
    if (!me) return;
    const isMine = msg.fromUserId === me.id;
    const otherId = isMine ? msg.toUserId : msg.fromUserId;
    // Se a conversa do outro lado está aberta, mostra inline E marca como lido.
    // Se não, incrementa contador.
    const conversationOpen = openWith === otherId;
    if (conversationOpen) {
      appendMsg(msg);
      if (!isMine) socket.emit('chat:read', { otherId });
    } else if (!isMine) {
      unreadByUser[otherId] = (unreadByUser[otherId] || 0) + 1;
      lastSenderId = otherId;
      bumpBadge();
      if (!panel.classList.contains('hidden') && !openWith) renderListView();
    }
    // SEMPRE mostra toast pra mensagens recebidas — mas SEM som quando a
    // conversa já está aberta (usuário tá vendo, não precisa de barulho).
    if (!isMine) {
      showTopToast(msg, { silent: conversationOpen });
    }
  }

  // ── lista contatos / conversas ────────────────────────────────────
  async function loadContacts() {
    try {
      [contacts, conversations] = await Promise.all([
        API.get('/api/chat/contacts'),
        API.get('/api/chat/conversations'),
      ]);
    } catch (e) {
      console.error(e);
    }
  }

  function renderListView() {
    panel.querySelector('.chat-body').innerHTML = `
      <div class="chat-search">
        <input id="chat-search" placeholder="Buscar contato..." />
      </div>
      <div id="chat-contacts-list" class="chat-list"></div>`;
    drawContactsList('');
    document.getElementById('chat-search').addEventListener('input', e => drawContactsList(e.target.value));
  }

  function drawContactsList(filter) {
    const f = (filter || '').trim().toLowerCase();
    const list = document.getElementById('chat-contacts-list');
    if (!list) return;

    // Ordena: contatos com mensagem (conversations) primeiro pela data, depois resto alfabético
    const convMap = new Map(conversations.map(c => [c.otherId, c]));
    const items = contacts
      .filter(c => !f || (c.name||'').toLowerCase().includes(f) || (c.email||'').toLowerCase().includes(f))
      .map(c => ({ ...c, _conv: convMap.get(c.id) }))
      .sort((a, b) => {
        const aLast = a._conv?.lastAt ? new Date(a._conv.lastAt).getTime() : 0;
        const bLast = b._conv?.lastAt ? new Date(b._conv.lastAt).getTime() : 0;
        if (aLast !== bLast) return bLast - aLast;
        return (a.name||'').localeCompare(b.name||'');
      });

    if (items.length === 0) {
      list.innerHTML = '<div class="muted small" style="padding:1rem;text-align:center">Nenhum contato</div>';
      return;
    }

    list.innerHTML = items.map(c => {
      const initials = avatarInitials(c.name);
      const color = avatarColor(c.id);
      const un = unreadByUser[c.id] || 0;
      const online = onlineUsers.has(c.id);
      const meta = [];
      if (c.role) meta.push(c.role);
      if (c.officeName) meta.push(c.officeName);
      const lastMsg = c._conv?.lastMessage || '';
      const lastAt  = c._conv?.lastAt ? formatRelative(c._conv.lastAt) : '';
      return `
        <div class="chat-item" data-id="${c.id}">
          <div class="chat-avatar" style="background:${color}">
            ${UI.escapeHtml(initials)}
            ${online ? '<span class="online-dot"></span>' : ''}
          </div>
          <div class="chat-item-body">
            <div class="chat-item-row">
              <strong>${UI.escapeHtml(c.name)}</strong>
              <span class="chat-item-time">${lastAt}</span>
            </div>
            <div class="chat-item-row">
              <span class="muted small chat-item-preview">${UI.escapeHtml(lastMsg || meta.join(' · '))}</span>
              ${un > 0 ? `<span class="chat-unread-pill">${un}</span>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.chat-item').forEach(el =>
      el.onclick = () => openThread(el.dataset.id));
  }

  // ── abre conversa ─────────────────────────────────────────────────
  async function openThread(otherId) {
    openWith = otherId;
    unreadByUser[otherId] = 0;
    bumpBadge();
    const contact = contacts.find(c => c.id === otherId);
    const initials = avatarInitials(contact?.name || '?');
    const color = avatarColor(otherId);
    const online = onlineUsers.has(otherId);

    panel.querySelector('.chat-body').innerHTML = `
      <div class="chat-thread-header">
        <button class="chat-back" id="chat-back" title="Voltar">←</button>
        <div class="chat-avatar small" style="background:${color}">
          ${UI.escapeHtml(initials)}
          ${online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="chat-thread-info">
          <strong>${UI.escapeHtml(contact?.name || '')}</strong>
          <span class="muted small">${online ? 'online' : (contact?.role || '')}</span>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages"><div class="muted small" style="text-align:center;padding:1rem">Carregando...</div></div>
      <form id="chat-form" class="chat-input">
        <input id="chat-input" placeholder="Digite uma mensagem..." autocomplete="off" maxlength="5000" />
        <button class="btn primary" type="submit" title="Enviar">→</button>
      </form>`;

    document.getElementById('chat-back').onclick = () => { openWith = null; renderListView(); };

    try {
      const msgs = await API.get(`/api/chat/messages/${otherId}`);
      const elMsgs = document.getElementById('chat-messages');
      elMsgs.innerHTML = '';
      msgs.forEach(appendMsg);
      socket?.emit('chat:read', { otherId });
    } catch (e) {
      document.getElementById('chat-messages').innerHTML = `<div class="err small" style="padding:.5rem">${e.message}</div>`;
    }

    document.getElementById('chat-form').addEventListener('submit', sendCurrent);
    document.getElementById('chat-input').focus();
  }

  function sendCurrent(ev) {
    ev.preventDefault();
    const inp = document.getElementById('chat-input');
    const txt = inp.value.trim();
    if (!txt || !openWith) return;
    inp.value = '';
    socket.emit('chat:send', { toUserId: openWith, content: txt }, (resp) => {
      if (!resp?.ok) UI.toast(resp?.error || 'Falha ao enviar', 'err');
    });
  }

  function appendMsg(m) {
    const elMsgs = document.getElementById('chat-messages');
    if (!elMsgs) return;
    const me = AUTH.user();
    const div = document.createElement('div');
    div.className = 'msg ' + (m.fromUserId === me.id ? 'me' : 'them');
    div.innerHTML = `<div class="msg-text">${UI.escapeHtml(m.content)}</div><span class="msg-ts">${formatRelative(m.createdAt)}</span>`;
    elMsgs.appendChild(div);
    elMsgs.scrollTop = elMsgs.scrollHeight;
  }

  // ── badge total ───────────────────────────────────────────────────
  async function refreshUnread() {
    try {
      const r = await API.get('/api/chat/unread');
      const total = r.count || 0;
      // Distribui no objeto se não tem contagem por user (server retorna só total)
      bumpBadge(total);
    } catch {}
  }
  function bumpBadge(forceTotal) {
    const sum = forceTotal != null
      ? forceTotal
      : Object.values(unreadByUser).reduce((s,n)=>s+n, 0);
    if (sum > 0) { badge.textContent = sum; badge.classList.remove('hidden'); }
    else         { badge.classList.add('hidden'); }
  }

  // ── toast no topo da tela ─────────────────────────────────────────
  // Aparece pra TODA mensagem recebida (não importa o estado do chat).
  // `silent: true` suprime o som — usado quando a conversa do remetente já está
  // aberta (usuário está vendo, não precisa de barulho).
  function showTopToast(msg, { silent = false } = {}) {
    const c = contacts.find(x => x.id === msg.fromUserId);
    const name = c?.name || 'Alguém';
    const initials = avatarInitials(name);
    const color = avatarColor(msg.fromUserId);
    let stack = document.getElementById('chat-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'chat-toast-stack';
      stack.className = 'chat-toast-stack';
      document.body.appendChild(stack);
    }
    const card = document.createElement('div');
    card.className = 'chat-toast-card';
    card.innerHTML = `
      <div class="chat-avatar small" style="background:${color}">${UI.escapeHtml(initials)}</div>
      <div class="chat-toast-body">
        <strong>${UI.escapeHtml(name)}</strong>
        <span>${UI.escapeHtml((msg.content || '').slice(0, 120))}</span>
      </div>
      <button type="button" class="chat-toast-close" aria-label="Fechar">&times;</button>`;
    card.onclick = (ev) => {
      if (ev.target.classList.contains('chat-toast-close')) {
        card.remove(); return;
      }
      panel.classList.remove('hidden');
      loadContacts().then(() => openThread(msg.fromUserId));
      card.remove();
    };
    stack.appendChild(card);
    if (!silent) playNotificationSound();
    // Notificação nativa do SO só quando aba não tem foco — evita poluir
    // quem está olhando a tela.
    if (!silent && !document.hasFocus()) {
      showSystemNotification(name, msg.content);
    }
    setTimeout(() => { card.classList.add('chat-toast-out'); setTimeout(() => card.remove(), 300); }, 7000);
  }

  // Toca um beep curto via Web Audio API — não depende de arquivo externo.
  let _audioCtx = null;
  function playNotificationSound() {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = _audioCtx;
      // Dois tons curtos (ding-dong)
      [880, 660].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.18);
        osc.stop(ctx.currentTime + i * 0.18 + 0.2);
      });
    } catch {} // se falhar (autoplay policy etc.) ignora silenciosamente
  }

  // Notificação nativa do sistema operacional (Chrome/Edge mostram fora da página).
  // Pede permissão na primeira mensagem se ainda não tiver.
  function showSystemNotification(name, content) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'denied') return;
    const fire = () => {
      try {
        const n = new Notification(`Vision · ${name}`, {
          body: String(content || '').slice(0, 200),
          tag: 'vision-chat', // notificações antigas são substituídas
          silent: true, // o beep do toast já toca
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch {}
    };
    if (Notification.permission === 'granted') fire();
    else if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => { if (p === 'granted') fire(); });
    }
  }

  // ── helpers ───────────────────────────────────────────────────────
  function avatarInitials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
  }
  function avatarColor(id) {
    const palette = ['#F58220','#4a90e2','#9860f0','#10c4b5','#00b894','#e74c3c','#f0a020','#1E2A3A'];
    let h = 0; for (const ch of String(id||'')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  }
  function formatRelative(dt) {
    if (!dt) return '';
    const d = new Date(dt);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'agora';
    if (diff < 3600) return Math.floor(diff/60) + ' min';
    const today = new Date();
    if (d.toDateString() === today.toDateString())
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (diff < 86400 * 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
    return d.toLocaleDateString('pt-BR');
  }

  return { init };
})();
