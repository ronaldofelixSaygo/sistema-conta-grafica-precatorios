window.VIEW_admin = (() => {
  function render() {
    const el = document.getElementById('view-admin');
    el.innerHTML = `
      <div class="panel">
        <h3>Migração de dados — sistema antigo</h3>
        <p class="muted small" style="margin-bottom:1rem">
          Cole a connection string do <strong>Neon antigo</strong> (Virgínia) abaixo. O sistema vai
          ler clientes, movimentações e usuários e gravar neste novo banco. Idempotente: pode rodar várias vezes.
        </p>
        <form id="form-mig">
          <div style="margin-bottom:.75rem">
            <label class="muted small">Connection string do Neon antigo</label>
            <input id="mig-url" type="text" style="width:100%;padding:8px 10px;background:var(--s2);border:1px solid var(--bd2);border-radius:8px;color:var(--t1);margin-top:4px"
              placeholder="postgresql://user:senha@host.neon.tech/dbname?sslmode=require" />
          </div>
          <div style="margin-bottom:.75rem">
            <label><input type="checkbox" id="mig-dry" checked> Dry-run (não escreve, só conta)</label>
          </div>
          <button type="submit" class="btn primary">Executar migração</button>
          <button type="button" class="btn" id="mig-clear" style="margin-left:.5rem">Limpar</button>
        </form>
        <pre id="mig-out" style="margin-top:1rem;background:var(--s2);padding:1rem;border-radius:8px;font-size:12px;max-height:400px;overflow:auto;color:var(--t2)"></pre>
      </div>
    `;
    document.getElementById('mig-clear').onclick = () => {
      document.getElementById('mig-out').textContent = '';
    };
    document.getElementById('form-mig').onsubmit = async ev => {
      ev.preventDefault();
      const url = document.getElementById('mig-url').value.trim();
      const dryRun = document.getElementById('mig-dry').checked;
      if (!url) return UI.toast('Cole a connection string', 'err');
      const out = document.getElementById('mig-out');
      out.textContent = `Executando ${dryRun?'(dry-run)':''}…`;
      try {
        const r = await API.post('/api/admin/migrate-from-old', { oldDatabaseUrl: url, dryRun });
        out.textContent = JSON.stringify(r, null, 2);
        UI.toast(dryRun ? 'Dry-run concluído' : 'Migração concluída');
      } catch (e) { out.textContent = 'ERRO: ' + e.message; UI.toast(e.message, 'err'); }
    };
  }
  return { render };
})();
