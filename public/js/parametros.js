window.VIEW_parametros = (() => {
  let perms = [], meta = null;

  async function render() {
    const el = document.getElementById('view-parametros');
    el.innerHTML = '<div class="muted">Carregando…</div>';
    try {
      const r = await API.get('/api/permissions');
      perms = r.items; meta = r.meta;
      drawMatrix();
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  function drawMatrix() {
    const el = document.getElementById('view-parametros');
    const moduleLabels = {
      dashboard:'Painel', clientes:'Clientes', movimentacoes:'Movimentações',
      saldos:'Saldos', comissoes:'Comissões', relatorios:'Relatórios',
      alertas:'Alertas', kanban:'Kanban', acionamentos:'Acionamentos',
      parceiros:'Parceiros', usuarios:'Usuários', auditoria:'Auditoria',
      migracao:'Migração', chat:'Chat', parametros:'Parâmetros',
    };
    const roleLabels = { ADM:'Administrador', SAYGO:'Saygo', PARTNER:'Parceiro', CLIENT:'Cliente' };

    el.innerHTML = `
      <div class="panel">
        <h3>Matriz de permissões por perfil</h3>
        <p class="muted small" style="margin-bottom:1rem">
          Marque o que cada perfil pode fazer em cada módulo. ADM sempre tem acesso completo.
        </p>
        <div style="overflow-x:auto">
          <table class="table">
            <thead>
              <tr>
                <th>Módulo</th>
                ${meta.ROLES.map(r => `<th colspan="4" style="text-align:center;border-left:1px solid var(--bd2)">${roleLabels[r]||r}</th>`).join('')}
              </tr>
              <tr>
                <th></th>
                ${meta.ROLES.map(() => `
                  <th style="font-size:9px;border-left:1px solid var(--bd2)">VER</th>
                  <th style="font-size:9px">CRIAR</th>
                  <th style="font-size:9px">EDIT</th>
                  <th style="font-size:9px">EXCL</th>
                `).join('')}
              </tr>
            </thead>
            <tbody>
              ${meta.MODULES.map(mod => {
                const cells = meta.ROLES.map(role => {
                  const p = perms.find(x => x.role===role && x.module===mod);
                  if (!p) return '<td>—</td>'.repeat(4);
                  const cb = (k) => `<input type="checkbox" data-pid="${p.id}" data-k="${k}" ${p[k]?'checked':''} ${role==='ADM'?'disabled':''}>`;
                  return `
                    <td style="text-align:center;border-left:1px solid var(--bd2)">${cb('canView')}</td>
                    <td style="text-align:center">${cb('canCreate')}</td>
                    <td style="text-align:center">${cb('canEdit')}</td>
                    <td style="text-align:center">${cb('canDelete')}</td>`;
                }).join('');
                return `<tr><td><strong>${moduleLabels[mod]||mod}</strong></td>${cells}</tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:1rem;display:flex;gap:.5rem">
          <button class="btn primary" id="pe-save">Salvar alterações</button>
          <button class="btn" id="pe-reset">Restaurar padrões</button>
        </div>
        <div class="muted small" style="margin-top:.75rem">
          ⚠ Por enquanto, os bloqueios são aplicados pelos perfis padrão (ADM, SAYGO, PARTNER, CLIENT).
          Esta matriz registra suas escolhas, mas a aplicação granular de cada checkbox no backend
          virá em uma versão futura.
        </div>
      </div>
    `;

    document.getElementById('pe-save').onclick = save;
    document.getElementById('pe-reset').onclick = async () => {
      if (!confirm('Restaurar permissões padrão?')) return;
      try { await API.post('/api/permissions/reset'); UI.toast('Restaurado'); render(); }
      catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  async function save() {
    const checks = document.querySelectorAll('[data-pid]');
    const byPid = {};
    checks.forEach(c => {
      const pid = c.dataset.pid, k = c.dataset.k;
      byPid[pid] = byPid[pid] || {};
      byPid[pid][k] = c.checked;
    });
    let count = 0, fail = 0;
    for (const [pid, body] of Object.entries(byPid)) {
      try { await API.put(`/api/permissions/${pid}`, body); count++; }
      catch { fail++; }
    }
    UI.toast(`${count} salvo${fail?`, ${fail} falha${fail>1?'s':''}`:''}`, fail?'err':'ok');
  }

  return { render };
})();
