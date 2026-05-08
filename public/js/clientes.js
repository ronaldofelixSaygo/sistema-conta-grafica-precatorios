window.VIEW_clientes = (() => {
  let cache = [];
  let filterEsc = '';

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
      cache = await API.get('/api/clientes');
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
        const e = document.getElementById('cli-esc')?.value || '';
        const list = cache.filter(c => {
          if (e && c.escritorio !== e) return false;
          if (!f) return true;
          return (c.nome||'').toLowerCase().includes(f)
              || (c.cnpj||'').toLowerCase().includes(f);
        });
        document.getElementById('cli-table').innerHTML = UI.table({
          cols: [
            { label: 'Nome', key: 'nome' },
            { label: 'Escritório', key: 'escritorio' },
            { label: 'Sala',          html: true, get: r => pill(r.locacaoSala) },
            { label: 'Filial',        html: true, get: r => pill(r.aberturaFilial) },
            { label: 'IE',            html: true, get: r => pill(r.reativacaoIe) },
            { label: 'Conta Gráfica', html: true, get: r => pill(r.contaGrafica) },
            { label: 'Crédito Cert.', html: true, get: r => pill(r.clienteCertificado) },
            { label: '% Comissão', align: 'right', get: r => (r.percentualComissao ?? 0) + '%' },
            { label: 'Dia Fech.',  align: 'right', key: 'diaFechamento' },
            { label: 'Ações', html: true, get: r => canMutate
              ? `<div class="actions"><button class="btn small" data-edit="${r.id}">Editar</button>
                  <button class="btn small danger" data-del="${r.id}">Excluir</button></div>` : '',
            },
          ],
          rows: list,
          empty: 'Nenhum cliente encontrado.',
        });
      };
      draw();
      document.getElementById('cli-search').addEventListener('input', draw);
      document.getElementById('cli-esc').addEventListener('change', draw);

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
        <div class="full"><label>Escritório (Parceiro principal)</label><input name="escritorio" value="${UI.escapeHtml(cli.escritorio||'')}"></div>

        <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.5rem"><strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Status dos serviços</strong></div>
        <div><label>Locação Sala</label>${selYesNo('locacao_sala',     cli.locacaoSala)}</div>
        <div><label>Abertura Filial</label>${selYesNo('abertura_filial',cli.aberturaFilial)}</div>
        <div><label>Reativação IE</label>${selYesNo('reativacao_ie',    cli.reativacaoIe)}</div>
        <div><label>Conta gráfica</label>${selYesNo('conta_grafica',    cli.contaGrafica)}</div>
        <div><label>Cliente certificado</label>${selYesNo('cliente_certificado', cli.clienteCertificado)}</div>

        <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.5rem"><strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Parceiros responsáveis</strong></div>
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
