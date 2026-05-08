window.CHAT = (() => {
  let socket = null;
  let contacts = [];
  let openWith = null;
  let unreadByUser = {};
  let totalUnread = 0;

  const panel    = document.getElementById('chat-panel');
  const btn      = document.getElementById('btn-chat-toggle');
  const close    = document.getElementById('chat-close');
  const badge    = document.getElementById('chat-badge');
  const elContacts = document.getElementById('chat-contacts');
  const elMsgs   = document.getElementById('chat-messages');
  const elHead   = document.getElementById('chat-thread-header');
  const formEl   = document.getElementById('chat-form');
  const inputEl  = document.getElementById('chat-input');

  btn.addEventListener('click', () => { panel.classList.toggle('hidden'); if (!panel.classList.contains('hidden')) loadContacts(); });
  close.addEventListener('click', () => panel.classList.add('hidden'));

  async function init() {
    const token = AUTH.getToken?.();
    socket = io('/', {
      withCredentials: true,
      auth: token ? { token } : {},
      transports: ['websocket', 'polling'],
    });
    socket.on('connect',       ()=> console.log('[chat] socket conectado'));
    socket.on('disconnect',    r => console.log('[chat] socket desconectado:', r));
    socket.on('connect_error', e => console.error('[chat] connect_error:', e?.message));

    socket.on('chat:message', (msg) => {
      const me = AUTH.user();
      const otherId = msg.fromUserId === me.id ? msg.toUserId : msg.fromUserId;
      if (openWith === otherId) {
        appendMsg(msg);
        socket.emit('chat:read', { otherId });
      } else {
        unreadByUser[otherId] = (unreadByUser[otherId] || 0) + 1;
        bumpBadge();
        renderContacts();
        UI.toast(`Nova mensagem de ${contactName(otherId)}`);
      }
    });

    formEl.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const txt = inputEl.value.trim();
      if (!txt || !openWith) return;
      socket.emit('chat:send', { toUserId: openWith, content: txt }, (resp) => {
        if (!resp?.ok) UI.toast(resp?.error || 'Falha ao enviar', 'err');
      });
      inputEl.value = '';
    });

    refreshUnread();
    setInterval(refreshUnread, 30_000);
  }

  async function refreshUnread() {
    try {
      const r = await API.get('/api/chat/unread');
      totalUnread = r.count || 0;
      bumpBadge();
    } catch {}
  }

  function bumpBadge() {
    const sum = Object.values(unreadByUser).reduce((s, n) => s + n, 0) || totalUnread;
    if (sum > 0) { badge.textContent = sum; badge.classList.remove('hidden'); }
    else         { badge.classList.add('hidden'); }
  }

  async function loadContacts() {
    elContacts.innerHTML = '<div class="muted small" style="padding:.5rem">Carregando…</div>';
    try {
      contacts = await API.get('/api/chat/contacts');
      renderContacts();
    } catch (e) {
      elContacts.innerHTML = `<div class="err small" style="padding:.5rem">${e.message}</div>`;
    }
  }

  function contactName(id) { return contacts.find(c => c.id===id)?.name || '—'; }

  function renderContacts() {
    if (!contacts.length) {
      elContacts.innerHTML = '<div class="muted small" style="padding:.5rem">Sem contatos</div>';
      return;
    }
    elContacts.innerHTML = contacts.map(c => {
      const un = unreadByUser[c.id] || 0;
      return `<div class="chat-contact ${openWith===c.id?'active':''}" data-id="${c.id}">
        ${UI.escapeHtml(c.name)}${un?` <span class="un">${un}</span>`:''}
        <span class="role">${c.role}${c.officeName?` · ${UI.escapeHtml(c.officeName)}`:''}</span>
      </div>`;
    }).join('');
    elContacts.onclick = (ev) => {
      const id = ev.target.closest('.chat-contact')?.getAttribute('data-id');
      if (id) openThread(id);
    };
  }

  async function openThread(otherId) {
    openWith = otherId;
    unreadByUser[otherId] = 0; bumpBadge();
    renderContacts();
    elHead.textContent = contactName(otherId);
    formEl.classList.remove('hidden');
    elMsgs.innerHTML = '<div class="muted small" style="padding:.5rem">Carregando…</div>';
    try {
      const msgs = await API.get(`/api/chat/messages/${otherId}`);
      elMsgs.innerHTML = '';
      msgs.forEach(appendMsg);
      socket?.emit('chat:read', { otherId });
    } catch (e) {
      elMsgs.innerHTML = `<div class="err small" style="padding:.5rem">${e.message}</div>`;
    }
    inputEl.focus();
  }

  function appendMsg(m) {
    const me = AUTH.user();
    const div = document.createElement('div');
    div.className = 'msg ' + (m.fromUserId === me.id ? 'me' : 'them');
    div.innerHTML = `${UI.escapeHtml(m.content)}<span class="ts">${UI.fmtDateTime(m.createdAt)}</span>`;
    elMsgs.appendChild(div);
    elMsgs.scrollTop = elMsgs.scrollHeight;
  }

  return { init };
})();
