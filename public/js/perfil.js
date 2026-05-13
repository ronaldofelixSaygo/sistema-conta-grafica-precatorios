// =====================================================================
// Tela "Meu Perfil" — dados básicos, foto e troca de senha.
// =====================================================================
window['VIEW_perfil'] = (() => {
  function avatarUrl(user) {
    if (!user?.avatarUpdated) return null;
    const t = new Date(user.avatarUpdated).getTime();
    return `/api/auth/avatar/${user.id}?v=${t}`;
  }

  function initials(name) {
    return String(name || '?')
      .split(/\s+/).filter(Boolean).slice(0, 2)
      .map(s => s[0]?.toUpperCase() || '').join('') || '?';
  }

  function roleLabel(r) {
    return ({ ADM: 'Administrador', SAYGO: 'Usuário Saygo', PARTNER: 'Interveniente', CLIENT: 'Cliente' })[r] || r;
  }

  async function render() {
    const el = document.getElementById('view-perfil');
    const me = AUTH.user();
    if (!me) { el.innerHTML = '<div class="muted">Não autenticado</div>'; return; }

    const url = avatarUrl(me);
    el.innerHTML = `
      <div class="profile-grid">
        <!-- Coluna esquerda: foto + identificação -->
        <div class="panel profile-card">
          <div class="profile-avatar-wrap">
            ${url
              ? `<img id="profile-avatar-img" class="profile-avatar" src="${url}" alt="${UI.escapeHtml(me.name)}"/>`
              : `<div id="profile-avatar-img" class="profile-avatar profile-avatar-fallback">${initials(me.name)}</div>`}
            <label class="profile-avatar-edit" title="Alterar foto">
              📷
              <input type="file" id="avatar-input" accept="image/png,image/jpeg,image/webp" style="display:none">
            </label>
          </div>
          <h2 style="margin:.5rem 0 .2rem">${UI.escapeHtml(me.name)}</h2>
          <div class="muted small">${UI.escapeHtml(roleLabel(me.role))}${me.officeName ? ` · ${UI.escapeHtml(me.officeName)}` : ''}</div>
          <div style="display:flex;gap:.4rem;justify-content:center;margin-top:.8rem;flex-wrap:wrap">
            <button class="btn small ghost" id="btn-avatar-pick">Trocar foto</button>
            ${url ? '<button class="btn small danger" id="btn-avatar-del">Remover foto</button>' : ''}
          </div>
          <div class="muted small" style="margin-top:.5rem">PNG, JPG ou WEBP até 2 MB</div>
        </div>

        <!-- Coluna direita: dados + senha -->
        <div style="display:flex;flex-direction:column;gap:1rem">
          <div class="panel">
            <h3 style="margin-top:0">Informações pessoais</h3>
            <div class="profile-info">
              <div>
                <label>Nome</label>
                <div class="profile-value">${UI.escapeHtml(me.name || '—')}</div>
              </div>
              <div>
                <label>E-mail</label>
                <div class="profile-value">${UI.escapeHtml(me.email || '—')}</div>
              </div>
              <div>
                <label>Perfil</label>
                <div class="profile-value">${UI.escapeHtml(roleLabel(me.role))}</div>
              </div>
              ${me.officeName ? `
                <div>
                  <label>Escritório</label>
                  <div class="profile-value">${UI.escapeHtml(me.officeName)}</div>
                </div>` : ''}
            </div>
            <div class="muted small" style="margin-top:.5rem">Para alterar nome ou e-mail, peça ao administrador.</div>
          </div>

          <div class="panel">
            <h3 style="margin-top:0">Trocar senha</h3>
            <form id="form-change-pwd" class="form-grid">
              <div class="full">
                <label>Senha atual</label>
                <input type="password" name="current" required autocomplete="current-password">
              </div>
              <div>
                <label>Nova senha</label>
                <input type="password" name="next" required minlength="6" autocomplete="new-password">
              </div>
              <div>
                <label>Confirmar nova senha</label>
                <input type="password" name="confirm" required minlength="6" autocomplete="new-password">
              </div>
              <div class="full form-actions" style="justify-content:flex-end">
                <button type="submit" class="btn primary">Alterar senha</button>
              </div>
            </form>
            <div class="muted small">Mínimo 6 caracteres. Você continuará logado nesta sessão após a alteração.</div>
          </div>
        </div>
      </div>
    `;
    bindActions();
  }

  function bindActions() {
    document.getElementById('btn-avatar-pick')?.addEventListener('click', () => {
      document.getElementById('avatar-input').click();
    });
    document.getElementById('avatar-input')?.addEventListener('change', uploadAvatar);
    document.getElementById('btn-avatar-del')?.addEventListener('click', removeAvatar);
    document.getElementById('form-change-pwd')?.addEventListener('submit', changePassword);
  }

  async function uploadAvatar(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { UI.toast('Foto muito grande (máx 2 MB)', 'err'); return; }
    const fd = new FormData();
    fd.append('file', file);
    try {
      const resp = await fetch('/api/auth/avatar', { method: 'POST', body: fd, credentials: 'include' });
      if (!resp.ok) {
        const txt = await resp.text();
        let msg = txt; try { msg = JSON.parse(txt).error || msg; } catch {}
        throw new Error(msg);
      }
      UI.toast('Foto atualizada');
      // Recarrega user (puxa novo avatarUpdated) e re-renderiza
      await AUTH.tryRestore();
      render();
      // Atualiza miniatura na sidebar
      window.PERFIL?.refreshSidebar();
    } catch (e) { UI.toast(e.message, 'err'); }
  }

  async function removeAvatar() {
    if (!confirm('Remover sua foto?')) return;
    try {
      await API.del('/api/auth/avatar');
      UI.toast('Foto removida');
      await AUTH.tryRestore();
      render();
      window.PERFIL?.refreshSidebar();
    } catch (e) { UI.toast(e.message, 'err'); }
  }

  async function changePassword(ev) {
    ev.preventDefault();
    const f = ev.target;
    const current = f.current.value;
    const next    = f.next.value;
    const confirm = f.confirm.value;
    if (next !== confirm) { UI.toast('A confirmação não confere', 'err'); return; }
    if (next.length < 6)  { UI.toast('Mínimo 6 caracteres', 'err'); return; }
    try {
      await API.post('/api/auth/change-password', { current, next });
      UI.toast('Senha alterada com sucesso');
      f.reset();
    } catch (e) { UI.toast(e.message || 'Falha ao trocar senha', 'err'); }
  }

  // Helper exposto pra outras telas atualizarem a miniatura na sidebar
  // (chamado depois de upload/remove).
  function refreshSidebar() {
    const me = AUTH.user();
    const wrap = document.getElementById('me-avatar');
    if (!wrap) return;
    const url = avatarUrl(me);
    wrap.innerHTML = url
      ? `<img src="${url}" alt="${UI.escapeHtml(me.name)}"/>`
      : `<span>${initials(me.name)}</span>`;
  }

  return { render, refreshSidebar, avatarUrl, initials };
})();
window.PERFIL = window['VIEW_perfil'];
