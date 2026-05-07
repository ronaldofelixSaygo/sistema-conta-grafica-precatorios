window.VIEW_clientes = (() => {
  let cache = [];

  async function render() {
    const el = document.getElementById('view-clientes');
    el.innerHTML = '<div class="muted">Carregando…</div>';
    try {
      cache = await API.get('/api/clientes');
      const canMutate = AUTH.isStaff();
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;gap:.5rem;flex-wrap:wrap">
          <input id="cli-search" placeholder="Buscar cliente..." class="filters" style="min-width:260px;padding:7px 10px;background:var(--s2);border:1px solid var(--bd2);border-radius:8px;color:var(--t1)" />
          ${canMutate ? '<button class="btn primary" id="btn-new-cli">+ Novo cliente</button>' : ''}
        </div>
        <div id="cli-table"></div>`;
      const draw = (filter='') => {
        const f = filter.toLowerCase();
        const list = cache.filter(c => !f
          || (c.nome||'').toLowerCase().includes(f)
          || (c.escritorio||'').toLowerCase().includes(f)
          || (c.cnpj||'').toLowerCase().includes(f));
        document.getElementById('cli-table').innerHTML = UI.table({
          cols: [
            { label: 'Nome', key: 'nome' },
            { label: 'CNPJ', key: 'cnpj' },
            { label: 'Escritório', key: 'escritorio' },
            { label: '%', align: 'right', get: r => (r.percentualComissao ?? 0) + '%' },
            { label: 'Fech.', align: 'right', key: 'diaFechamento' },
            { label: '', html: true, get: r => canMutate
              ? `<div class="actions"><button class="btn small" data-edit="${r.id}">Editar</button>
                  <button class="btn small danger" data-del="${r.id}">×</button></div>` : '',
            },
          ],
          rows: list,
          empty: 'Nenhum cliente encontrado.',
        });
      };
      draw();

      document.getElementById('cli-search').addEventListener('input', e => draw(e.target.value));

      if (canMutate) {
        document.getElementById('btn-new-cli').addEventListener('click', () => openForm());
        el.addEventListener('click', e => {
          const id = e.target.getAttribute('data-edit') || e.target.getAttribute('data-del');
          if (!id) return;
          if (e.target.dataset.edit) openForm(cache.find(c => String(c.id) === id));
          if (e.target.dataset.del)  removeCli(id);
        });
      }
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  function openForm(cli = {}) {
    UI.openModal(cli.id ? `Editar cliente #${cli.id}` : 'Novo cliente', `
      <form id="form-cli" class="form-grid">
        <div class="full"><label>Nome *</label><input name="nome" required value="${UI.escapeHtml(cli.nome||'')}"></div>
        <div><label>CNPJ</label><input name="cnpj" value="${UI.escapeHtml(cli.cnpj||'')}"></div>
        <div><label>CNPJ filial</label><input name="cnpj_filial" value="${UI.escapeHtml(cli.cnpjFilial||'')}"></div>
        <div class="full"><label>Escritório (Parceiro principal)</label><input name="escritorio" value="${UI.escapeHtml(cli.escritorio||'')}"></div>

        <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.5rem"><strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Status dos serviços</strong></div>
        <div><label>Locação Sala</label><input name="locacao_sala" value="${UI.escapeHtml(cli.locacaoSala||'')}"></div>
        <div><label>Abertura Filial</label><input name="abertura_filial" value="${UI.escapeHtml(cli.aberturaFilial||'')}"></div>
        <div><label>Reativação IE</label><input name="reativacao_ie" value="${UI.escapeHtml(cli.reativacaoIe||'')}"></div>
        <div><label>Conta gráfica</label><input name="conta_grafica" value="${UI.escapeHtml(cli.contaGrafica||'')}"></div>
        <div><label>Cliente certificado</label><input name="cliente_certificado" value="${UI.escapeHtml(cli.clienteCertificado||'')}"></div>

        <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.5rem"><strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Parceiros responsáveis (sistema antigo)</strong></div>
        <div><label>Parceiro Sala</label><input name="parceiro_sala" value="${UI.escapeHtml(cli.parceiroSala||'')}"></div>
        <div><label>Parceiro Filial</label><input name="parceiro_filial" value="${UI.escapeHtml(cli.parceiroFilial||'')}"></div>
        <div><label>Parceiro IE</label><input name="parceiro_ie" value="${UI.escapeHtml(cli.parceiroIe||'')}"></div>

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
        UI.toast('Cliente salvo');
        UI.closeModal();
        render();
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
