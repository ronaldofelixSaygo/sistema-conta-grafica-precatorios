window.VIEW_clientes = (() => {
  let cache = [];

  function isYes(v) {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === 'sim' || s === 's' || s === 'true' || s === '1' || s === 'yes';
  }
  function pill(v) {
    return isYes(v)
      ? '<span class="pill yes">Sim</span>'
      : '<span class="pill no">Não</span>';
  }

  async function render() {
    const el = document.getElementById('view-clientes');
    el.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      cache = await API.get('/api/clientes', null, { ttl: 30000 });
      // Se for CLIENT, mostra tela de detalhe (vê apenas o seu cliente)
      if (AUTH.role() === 'CLIENT') return renderClientDetail(cache[0]);
      return renderList();
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  // ===== TELA DE DETALHE (somente para perfil CLIENT) =====
  function fieldHtml(label, value, opts = {}) {
    if (value === undefined) return '';  // campo restrito (oculto pelo backend)
    const v = (value === null || value === '') ? '—' : value;
    const cls = opts.pill ? `<span class="pill ${isYes(value)?'yes':'no'}">${isYes(value)?'Sim':'Não'}</span>` : UI.escapeHtml(String(v));
    return `
      <div class="field-row">
        <label>${UI.escapeHtml(label)}</label>
        <div>${opts.pill ? cls : (opts.html ? v : UI.escapeHtml(String(v)))}</div>
      </div>`;
  }

  function renderClientDetail(c) {
    const el = document.getElementById('view-clientes');
    if (!c) {
      el.innerHTML = '<div class="panel"><div class="muted">Nenhum dado encontrado para o seu cliente.</div></div>';
      return;
    }
    el.innerHTML = `
      <div class="panel">
        <h3>Meus dados</h3>
        <div class="client-grid">
          ${fieldHtml('Nome', c.nome)}
          ${c.cnpj          !== undefined ? fieldHtml('CNPJ', c.cnpj) : ''}
          ${c.cnpjFilial    !== undefined ? fieldHtml('CNPJ filial', c.cnpjFilial) : ''}
          ${fieldHtml('Escritório (parceiro principal)', c.escritorio)}
        </div>
      </div>
      <div class="panel">
        <h3>Status dos serviços</h3>
        <div class="client-grid">
          ${c.locacaoSala         !== undefined ? fieldHtml('Locação Sala',     c.locacaoSala,     { pill: true }) : ''}
          ${c.aberturaFilial      !== undefined ? fieldHtml('Filial/Empresa',   c.aberturaFilial,  { pill: true }) : ''}
          ${c.reativacaoIe        !== undefined ? fieldHtml('Reativação IE',     c.reativacaoIe,    { pill: true }) : ''}
          ${c.contaGrafica        !== undefined ? fieldHtml('Conta Gráfica',     c.contaGrafica,    { pill: true }) : ''}
          ${c.clienteCertificado  !== undefined ? fieldHtml('Cliente Certificado', c.clienteCertificado, { pill: true }) : ''}
        </div>
      </div>
      ${c.observacoes !== undefined ? `
        <div class="panel">
          <h3>Observações</h3>
          <div class="muted small" style="white-space:pre-wrap">${UI.escapeHtml(c.observacoes || '—')}</div>
        </div>` : ''}
    `;
  }

  const CACHE_TTL = 60_000; // 60s
  // ===== LISTA (Saygo / Adm / Parceiro Escritorio) =====
  function renderList() {
    const el = document.getElementById('view-clientes');
    const canMutate = AUTH.canMutate('clientes');
    const escritorios = [...new Set(cache.map(c => c.escritorio).filter(Boolean))].sort();
    el.innerHTML = `
      <div class="page-toolbar">
        <input id="cli-search" placeholder="Buscar cliente..." />
        <select id="cli-esc">
          <option value="">Todos os escritórios</option>
          ${escritorios.map(e => `<option value="${UI.escapeHtml(e)}">${UI.escapeHtml(e)}</option>`).join('')}
        </select>
        ${canMutate ? '<button class="btn primary" id="btn-new-cli" style="margin-left:auto">+ Novo Cliente</button>' : ''}
      </div>
      <div id="cli-table"></div>`;

    const draw = () => {
      const f = (document.getElementById('cli-search')?.value || '').toLowerCase();
      const esc = document.getElementById('cli-esc')?.value || '';
      const list = cache.filter(c => {
        if (esc && c.escritorio !== esc) return false;
        if (!f) return true;
        return (c.nome||'').toLowerCase().includes(f)
            || (c.cnpj||'').toLowerCase().includes(f);
      });
      // Monta colunas — pula as que estão restritas (undefined)
      const sample = cache[0] || {};
      const cols = [
        { label: 'Nome', key: 'nome' },
        { label: 'Escritório', key: 'escritorio' },
        sample.locacaoSala         !== undefined && { label: 'Sala',          html: true, get: r => pill(r.locacaoSala) },
        sample.aberturaFilial      !== undefined && { label: 'Filial/Empresa', html: true, get: r => pill(r.aberturaFilial) },
        sample.reativacaoIe        !== undefined && { label: 'IE',            html: true, get: r => pill(r.reativacaoIe) },
        sample.contaGrafica        !== undefined && { label: 'Conta Gráfica', html: true, get: r => pill(r.contaGrafica) },
        sample.clienteCertificado  !== undefined && { label: 'Crédito Cert.', html: true, get: r => pill(r.clienteCertificado) },
        sample.percentualComissao  !== undefined && { label: '% Comissão', align: 'right', get: r => (r.percentualComissao ?? 0) + '%' },
        sample.diaFechamento       !== undefined && { label: 'Dia Fech.',  align: 'right', key: 'diaFechamento' },
        canMutate && { label: 'Ações', html: true, get: r =>
          `<div class="actions"><button class="btn small" data-edit="${r.id}">Editar</button>
            <button class="btn small danger" data-del="${r.id}">Excluir</button></div>` },
      ].filter(Boolean);
      document.getElementById('cli-table').innerHTML = UI.table({
        cols, rows: list, empty: 'Nenhum cliente encontrado.',
      });
    };
    draw();
    document.getElementById('cli-search').addEventListener('input', draw);
    document.getElementById('cli-esc').addEventListener('change', draw);

    if (canMutate) {
      document.getElementById('btn-new-cli').addEventListener('click', () => openForm());
      document.getElementById('view-clientes').addEventListener('click', e => {
        const id = e.target.getAttribute('data-edit') || e.target.getAttribute('data-del');
        if (!id) return;
        if (e.target.dataset.edit) openForm(cache.find(c => String(c.id) === id));
        if (e.target.dataset.del)  removeCli(id);
      });
    }
  }

  function selYesNo(name, val) {
    return `<select name="${name}">
      <option value=""    ${!val?'selected':''}>--</option>
      <option value="Sim" ${isYes(val)?'selected':''}>Sim</option>
      <option value="Não" ${val && !isYes(val) ?'selected':''}>Não</option>
    </select>`;
  }

  function openForm(cli = {}) {
    UI.openModal(cli.id ? `Editar cliente #${cli.id}` : 'Novo cliente', `
      <form id="form-cli" class="form-grid">
        <div class="full"><label>Nome *</label><input name="nome" required value="${UI.escapeHtml(cli.nome||'')}"></div>
        <div><label>CNPJ</label><input name="cnpj" data-mask="cnpj" maxlength="18" value="${UI.escapeHtml(cli.cnpj||'')}"></div>
        <div><label>CNPJ filial</label><input name="cnpj_filial" data-mask="cnpj" maxlength="18" value="${UI.escapeHtml(cli.cnpjFilial||'')}"></div>
        <div class="full"><label>Escritório (Interveniente principal)</label><input name="escritorio" value="${UI.escapeHtml(cli.escritorio||'')}"></div>

        <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.5rem"><strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Status dos serviços</strong></div>
        <div><label>Locação Sala</label>${selYesNo('locacao_sala',     cli.locacaoSala)}</div>
        <div><label>Filial/Empresa</label>${selYesNo('abertura_filial',cli.aberturaFilial)}</div>
        <div><label>Reativação IE</label>${selYesNo('reativacao_ie',    cli.reativacaoIe)}</div>
        <div><label>Conta gráfica</label>${selYesNo('conta_grafica',    cli.contaGrafica)}</div>
        <div><label>Cliente certificado</label>${selYesNo('cliente_certificado', cli.clienteCertificado)}</div>

        <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.5rem"><strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Intervenientes responsáveis</strong></div>
        <div><label>Interveniente Sala</label><input name="parceiro_sala" value="${UI.escapeHtml(cli.parceiroSala||'')}"></div>
        <div><label>Interveniente Filial</label><input name="parceiro_filial" value="${UI.escapeHtml(cli.parceiroFilial||'')}"></div>
        <div><label>Interveniente IE</label><input name="parceiro_ie" value="${UI.escapeHtml(cli.parceiroIe||'')}"></div>

        <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.5rem"><strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Comissão</strong></div>
        <div><label>% Comissão</label><input type="number" step="0.01" name="percentual_comissao" value="${cli.percentualComissao ?? 0}"></div>
        <div><label>Dia de fechamento</label><input type="number" min="1" max="31" name="dia_fechamento" value="${cli.diaFechamento ?? 1}"></div>

        <div class="full"><label>Observações</label><textarea name="observacoes" rows="3">${UI.escapeHtml(cli.observacoes||'')}</textarea></div>
        <div class="full form-actions">
          <button type="button" class="btn" id="cli-cancel">Cancelar</button>
          <button class="btn primary" type="submit">Salvar</button>
        </div>
      </form>`);
    document.getElementById('cli-cancel').onclick = UI.closeModal;
    document.getElementById('form-cli').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const data = Object.fromEntries(fd.entries());
      try {
        if (cli.id) await API.put(`/api/clientes/${cli.id}`, data);
        else        await API.post('/api/clientes', data);
        UI.toast('Cliente salvo'); UI.closeModal(); render();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  async function removeCli(id) {
    if (!confirm('Excluir este cliente? Movimentações serão excluídas em cascata.')) return;
    try { await API.del(`/api/clientes/${id}`); UI.toast('Cliente excluído'); render(); }
    catch (e) { UI.toast(e.message, 'err'); }
  }

  return { render };
})();
