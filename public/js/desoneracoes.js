window.VIEW_desoneracoes = (() => {
  let listCache = [];
  let parceirosCache = [];
  let clientesCache = [];

  const STEP_LABELS = {
    DOCS_DESPACHANTE:  '1. Docs do Despachante',
    EMISSAO_DMI:       '2. Emissão DMI',
    EMISSAO_NF:        '3. Emissão NFs',
    VALIDACAO_NF:      '4. Validação NFs',
    ENVIO_NF_OFICIAL:  '5. NFs Oficiais',
    PROTOCOLO_ICMS:    '6. Protocolo ICMS',
    CONCLUIDO:         '✓ Concluído',
  };
  const STEP_ORDER = ['DOCS_DESPACHANTE','EMISSAO_DMI','EMISSAO_NF','VALIDACAO_NF','ENVIO_NF_OFICIAL','PROTOCOLO_ICMS'];

  const MODAL_LABELS = { MARITIMO:'Marítimo', AEREO:'Aéreo', RODOVIARIO:'Rodoviário' };

  function statusPill(s) {
    const m = {
      EM_ANDAMENTO: 'amber', AGUARDANDO_APROVACAO: 'blue',
      CONCLUIDA: 'green', CANCELADA: 'red',
    };
    const labels = {
      EM_ANDAMENTO: 'Em andamento', AGUARDANDO_APROVACAO: 'Aguardando aprovação',
      CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada',
    };
    return `<span class="pill ${m[s]||'amber'}">${labels[s] || s}</span>`;
  }

  async function render() {
    const el = document.getElementById('view-desoneracoes');
    el.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      [listCache, parceirosCache, clientesCache] = await Promise.all([
        API.get('/api/desoneracoes'),
        API.get('/api/parceiros', null, { ttl: 60000 }).catch(() => []),
        API.get('/api/clientes', null, { ttl: 30000 }).catch(() => []),
      ]);
      drawList();
    } catch (e) { el.innerHTML = `<div class="err">${UI.escapeHtml(e.message)}</div>`; }
  }

  function drawList() {
    const el = document.getElementById('view-desoneracoes');
    const canCreate = AUTH.isStaff() || AUTH.isPartnerEscritorio();
    const escritorios = [...new Set(parceirosCache.filter(p => (p.kindCode||p.type)==='ESCRITORIO').map(p => p.nome))];
    const despachantes = parceirosCache.filter(p => (p.kindCode||p.type) !== 'ESCRITORIO');

    el.innerHTML = `
      <div class="page-toolbar">
        <select id="des-cli"><option value="">Todos clientes</option>${clientesCache.map(c => `<option value="${c.id}">${UI.escapeHtml(c.nome)}</option>`).join('')}</select>
        <select id="des-step">
          <option value="">Todas etapas</option>
          ${STEP_ORDER.map(s => `<option value="${s}">${STEP_LABELS[s]}</option>`).join('')}
          <option value="CONCLUIDO">${STEP_LABELS.CONCLUIDO}</option>
        </select>
        <select id="des-status">
          <option value="">Todos status</option>
          <option value="EM_ANDAMENTO">Em andamento</option>
          <option value="AGUARDANDO_APROVACAO">Aguardando aprovação</option>
          <option value="CONCLUIDA">Concluída</option>
          <option value="CANCELADA">Cancelada</option>
        </select>
        <select id="des-parc"><option value="">Filtrar por parceiro</option>${parceirosCache.map(p => `<option value="${p.id}">${UI.escapeHtml(p.nome)}</option>`).join('')}</select>
        ${canCreate ? '<button class="btn primary" id="des-new" style="margin-left:auto">+ Nova desoneração</button>' : ''}
      </div>
      <div class="muted small" style="margin:.4rem 0">${listCache.length} desoneração(ões)</div>
      <div id="des-table"></div>`;

    document.getElementById('des-cli').onchange = applyFilters;
    document.getElementById('des-step').onchange = applyFilters;
    document.getElementById('des-status').onchange = applyFilters;
    document.getElementById('des-parc').onchange = applyFilters;
    if (canCreate) document.getElementById('des-new').onclick = openCreateForm;
    drawTable(listCache);
  }
  function applyFilters() {
    const cli = document.getElementById('des-cli').value;
    const step = document.getElementById('des-step').value;
    const st = document.getElementById('des-status').value;
    const parc = document.getElementById('des-parc').value;
    let rows = listCache;
    if (cli)  rows = rows.filter(r => String(r.cliente?.id) === cli);
    if (step) rows = rows.filter(r => r.currentStep === step);
    if (st)   rows = rows.filter(r => r.status === st);
    if (parc) rows = rows.filter(r => (r.steps||[]).some(s => s.parceiroId === parc));
    drawTable(rows);
  }
  function drawTable(rows) {
    const html = UI.table({
      cols: [
        { label: 'Quando', get: r => UI.fmtDateTime(r.createdAt) },
        { label: 'Cliente', get: r => r.cliente?.nome },
        { label: 'DUIMP/DI', get: r => r.duimpDi || '—' },
        { label: 'Modal', get: r => MODAL_LABELS[r.modal] || r.modal },
        { label: 'Etapa', get: r => STEP_LABELS[r.currentStep] || r.currentStep },
        { label: 'ICMS desonerado', align:'right', get: r => UI.fmtMoney(r.valorIcmsDesonerado||0) },
        { label: 'Status', html: true, get: r => statusPill(r.status) },
        { label: '', html: true, get: r => `<button class="btn small" data-open="${r.id}">Abrir</button>` },
      ],
      rows,
      empty: 'Nenhuma desoneração.',
    });
    const tbl = document.getElementById('des-table');
    tbl.innerHTML = html;
    tbl.onclick = e => {
      const id = e.target.getAttribute('data-open');
      if (id) openDetail(id);
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Formulário de criação
  // ─────────────────────────────────────────────────────────────────────
  async function openCreateForm() {
    const escritorios = parceirosCache.filter(p => (p.kindCode||p.type)==='ESCRITORIO');
    const despachantes = parceirosCache.filter(p => (p.kindCode||p.type) !== 'ESCRITORIO');
    UI.openModal('Nova desoneração', `
      <form id="form-des" class="form-grid">
        <div class="full"><label>Cliente *</label>
          <select name="clienteId" required><option value="">—</option>
            ${clientesCache.map(c => `<option value="${c.id}">${UI.escapeHtml(c.nome)}</option>`).join('')}
          </select>
        </div>
        <div><label>Modal *</label>
          <select name="modal" required>
            <option value="">—</option>
            <option value="MARITIMO">Marítimo</option>
            <option value="AEREO">Aéreo</option>
            <option value="RODOVIARIO">Rodoviário</option>
          </select>
        </div>
        <div><label>DUIMP/DI</label><input name="duimpDi" placeholder="ex: 26/0123456-7"></div>
        <div><label>Nº Processo</label><input name="numeroProcesso" placeholder="opcional"></div>
        <div><label>Valor mercadoria (R$)</label><input type="number" step="0.01" name="valorMercadoria"></div>
        <div class="full"><label>Valor ICMS a desonerar (R$) *</label><input type="number" step="0.01" name="valorIcmsDesonerado" required></div>
        <div class="full" style="border-top:1px solid var(--bd);padding-top:.4rem;margin-top:.2rem">
          <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Parceiros responsáveis (opcional — pode definir depois)</strong>
        </div>
        <div><label>Despachante</label>
          <select name="parc_DOCS_DESPACHANTE"><option value="">—</option>${despachantes.map(p => `<option value="${p.id}">${UI.escapeHtml(p.nome)}</option>`).join('')}</select>
        </div>
        <div><label>DMI / Validação / Protocolo</label>
          <select name="parc_EMISSAO_DMI"><option value="">—</option>${escritorios.map(p => `<option value="${p.id}">${UI.escapeHtml(p.nome)}</option>`).join('')}</select>
          <div class="muted small" style="margin-top:.2rem">Será aplicado pras 3 etapas Saygo (DMI + Validação + Protocolo). Pode trocar individualmente no detalhe.</div>
        </div>
        <div class="full form-actions">
          <button type="button" class="btn" id="des-cancel">Cancelar</button>
          <button type="submit" class="btn primary">Criar</button>
        </div>
      </form>`);
    document.getElementById('des-cancel').onclick = UI.closeModal;
    document.getElementById('form-des').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const escritorioId = fd.get('parc_EMISSAO_DMI') || null;
      const payload = {
        clienteId: Number(fd.get('clienteId')),
        modal: fd.get('modal'),
        duimpDi: fd.get('duimpDi') || null,
        numeroProcesso: fd.get('numeroProcesso') || null,
        valorMercadoria: fd.get('valorMercadoria') ? Number(fd.get('valorMercadoria')) : null,
        valorIcmsDesonerado: fd.get('valorIcmsDesonerado') ? Number(fd.get('valorIcmsDesonerado')) : null,
        parceiros: {
          DOCS_DESPACHANTE: fd.get('parc_DOCS_DESPACHANTE') || null,
          EMISSAO_DMI:      escritorioId,
          VALIDACAO_NF:     escritorioId,
          PROTOCOLO_ICMS:   escritorioId,
        },
      };
      try {
        const r = await API.post('/api/desoneracoes', payload);
        UI.toast('Desoneração criada'); UI.closeModal();
        await render();
        openDetail(r.id);
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Tela de detalhe
  // ─────────────────────────────────────────────────────────────────────
  async function openDetail(id) {
    let d;
    try { d = await API.get(`/api/desoneracoes/${id}`); }
    catch (e) { return UI.toast(e.message, 'err'); }

    const isStaff = AUTH.isStaff() || AUTH.isPartnerEscritorio();
    const stepperHtml = renderStepper(d);
    const painelHtml = renderPainel(d, isStaff);
    const notasHtml = renderNotas(d, isStaff);
    const docsHtml = renderDocs(d, isStaff);
    const histHtml = renderHistorico(d);

    UI.openModal(`Desoneração — ${UI.escapeHtml(d.cliente?.nome || '')}`, `
      <div class="muted small" style="margin-bottom:.4rem">
        ${UI.escapeHtml(d.cliente?.nome || '')} · DUIMP ${UI.escapeHtml(d.duimpDi || '—')} · Modal ${MODAL_LABELS[d.modal]} · ${statusPill(d.status)}
        ${d.cancelReason ? `<div class="err small" style="margin-top:.3rem">Cancelada: ${UI.escapeHtml(d.cancelReason)}</div>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:200px 1fr;gap:1rem;align-items:flex-start">
        <div>${stepperHtml}</div>
        <div>
          ${painelHtml}
          ${notasHtml}
          ${docsHtml}
          ${histHtml}
        </div>
      </div>`);
    bindDetailActions(d, isStaff);
  }

  function renderStepper(d) {
    const items = [...STEP_ORDER, 'CONCLUIDO'].map((s) => {
      const step = (d.steps || []).find(x => x.etapa === s);
      const done = step?.completedAt || (s === 'CONCLUIDO' && d.status === 'CONCLUIDA');
      const active = d.currentStep === s && d.status === 'EM_ANDAMENTO';
      const aguardando = s === 'CONCLUIDO' && d.status === 'AGUARDANDO_APROVACAO';
      const cor = done ? 'green' : (active || aguardando) ? 'blue' : 'gray';
      const icon = done ? '✓' : (active || aguardando) ? '●' : '○';
      const responsavelLabel = renderRespLabel(d, step);
      return `<div style="display:flex;gap:.5rem;padding:.4rem;align-items:flex-start">
        <div style="color:var(--${cor});font-weight:700">${icon}</div>
        <div style="flex:1;font-size:11px">
          <div style="font-weight:600">${STEP_LABELS[s]}</div>
          ${responsavelLabel ? `<div class="muted">👤 ${responsavelLabel}</div>` : ''}
          ${step?.completedAt ? `<div class="muted small">${UI.fmtDate(step.completedAt)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    return `<div class="panel" style="padding:.4rem">${items}</div>`;
  }

  // Retorna o label do responsável: parceiro do step (se houver) ou "Cliente" se
  // a config diz que é o cliente.
  function renderRespLabel(d, step) {
    if (!step) return '';
    if (step.parceiro?.nome) return UI.escapeHtml(step.parceiro.nome);
    const cfg = step.config;
    if (cfg?.responsavelTipo === 'CLIENTE') return `Cliente: ${UI.escapeHtml(d.cliente?.nome || '')}`;
    if (cfg?.responsavelTipo === 'CLIENTE_OU_PARCEIRO') return `Cliente${cfg.kindCode ? ` ou ${cfg.kindCode}` : ''}`;
    return cfg?.label || '';
  }

  function renderPainel(d, isStaff) {
    if (d.status === 'CONCLUIDA') {
      return `<div class="panel">
        <h3>Concluída em ${UI.fmtDateTime(d.concludedAt)}</h3>
        ${d.movimentacaoId ? `<div class="muted small">Movimentação #${d.movimentacaoId} criada no extrato do cliente.</div>` : ''}
      </div>`;
    }
    if (d.status === 'CANCELADA') {
      return `<div class="panel"><h3>Cancelada</h3>${d.cancelReason ? `<p>${UI.escapeHtml(d.cancelReason)}</p>` : ''}</div>`;
    }
    if (d.status === 'AGUARDANDO_APROVACAO') {
      return `<div class="panel">
        <h3>Aguardando aprovação</h3>
        <p class="muted small">Todas as etapas foram concluídas. Confira os dados abaixo e aprove pra criar a movimentação no extrato do cliente.</p>
        <table class="table"><tbody>
          <tr><td>Cliente</td><td>${UI.escapeHtml(d.cliente?.nome)}</td></tr>
          <tr><td>DUIMP/DI</td><td>${UI.escapeHtml(d.duimpDi || '—')}</td></tr>
          <tr><td>Valor ICMS desonerado</td><td class="num">${UI.fmtMoney(d.valorIcmsDesonerado)}</td></tr>
        </tbody></table>
        ${isStaff ? `
          <div class="form-actions" style="margin-top:.6rem">
            <button class="btn danger" id="des-cancel-btn">Cancelar desoneração</button>
            <button class="btn primary" id="des-approve-btn">✓ Aprovar e criar movimentação</button>
          </div>` : ''}
      </div>`;
    }
    // EM_ANDAMENTO
    const cur = (d.steps || []).find(s => s.etapa === d.currentStep);
    const podeAvancar = !!cur?.podeAtuar;
    const respLabel = renderRespLabel(d, cur);
    return `<div class="panel">
      <h3>Etapa atual: ${STEP_LABELS[d.currentStep]}</h3>
      <div class="muted small" style="margin:.3rem 0">Responsável: <strong>${respLabel || '—'}</strong></div>
      ${isStaff ? `
        <div style="display:flex;gap:.6rem;align-items:center;margin:.5rem 0">
          <label class="muted small">Trocar parceiro:</label>
          <select id="step-parc" style="flex:1">
            <option value="">—</option>
            ${parceirosCache.map(p => `<option value="${p.id}" ${cur?.parceiroId===p.id?'selected':''}>${UI.escapeHtml(p.nome)}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      <div class="form-actions">
        ${isStaff ? '<button class="btn danger" id="des-cancel-btn">Cancelar processo</button>' : ''}
        ${podeAvancar ? '<button class="btn primary" id="des-advance-btn">Avançar etapa →</button>' : ''}
      </div>
      ${!podeAvancar ? `<div class="muted small" style="margin-top:.4rem">⚠ Esta etapa precisa ser avançada pelo responsável: <strong>${respLabel}</strong>.</div>` : ''}
      <div class="muted small" style="margin-top:.4rem">Documentos obrigatórios são verificados ao avançar.</div>
    </div>`;
  }

  function renderNotas(d, isStaff) {
    const linhas = (d.notas || []).map(n => `
      <tr>
        <td><span class="pill ${n.tipo==='ENTRADA'?'green':'amber'}">${n.tipo}</span></td>
        <td>${UI.escapeHtml(n.numero)}${n.serie ? `/${UI.escapeHtml(n.serie)}` : ''}</td>
        <td>${n.dataEmissao ? UI.fmtDate(n.dataEmissao) : '—'}</td>
        <td class="num">${UI.fmtMoney(n.valor)}</td>
        <td>${n.validada ? '<span class="pill green">Validada</span>' : '<span class="pill amber">Pendente</span>'}</td>
        <td>${(n.oficialBytes || n.oficialNome) ? `
          <a class="btn small" href="/api/desoneracoes/notas/${n.id}/oficial" target="_blank" title="Visualizar">👁</a>
          <a class="btn small" href="/api/desoneracoes/notas/${n.id}/oficial" download="${UI.escapeHtml(n.oficialNome||'nf.pdf')}" title="Baixar">⬇</a>
        ` : '—'}</td>
        ${isStaff ? `<td>
          ${!n.validada ? `<button class="btn small" data-nf-validar="${n.id}">Validar</button>` : ''}
          <label class="btn small" style="cursor:pointer" title="Anexar oficial">📎<input type="file" data-nf-oficial="${n.id}" style="display:none" accept=".pdf,.xml,image/*"></label>
          <button class="btn small danger" data-nf-del="${n.id}">x</button>
        </td>` : ''}
      </tr>`).join('');
    return `<div class="panel" style="margin-top:.6rem">
      <h3>Notas Fiscais</h3>
      ${linhas ? `<table class="table"><thead><tr>
        <th>Tipo</th><th>Número</th><th>Data</th><th>Valor</th><th>Validação</th><th>Oficial</th>${isStaff?'<th></th>':''}
      </tr></thead><tbody>${linhas}</tbody></table>` : '<div class="muted small">Sem NFs cadastradas.</div>'}
      ${(() => {
        const cur = (d.steps || []).find(s => s.etapa === d.currentStep);
        const podeAdicionar = (isStaff || cur?.podeAtuar) && d.status === 'EM_ANDAMENTO';
        return podeAdicionar ? '<div style="margin-top:.5rem"><button class="btn" id="nf-add">+ Adicionar NF</button></div>' : '';
      })()}
    </div>`;
  }

  function renderDocs(d, isStaff) {
    const TIPOS = ['DUIMP','PL','PI','AFRMM','BL','CCT','DMI','DESPACHO','OUTRO'];
    const docs = d.documentos || [];
    const grouped = TIPOS.map(t => ({ t, items: docs.filter(x => x.tipo === t) })).filter(g => g.items.length);
    const html = grouped.map(g => `
      <div style="margin-bottom:.4rem">
        <strong class="muted small">${g.t}</strong>
        ${g.items.map(d2 => `<div style="display:flex;justify-content:space-between;padding:2px 0;align-items:center;gap:.4rem">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${UI.escapeHtml(d2.nome)}</span>
          <a class="btn small" href="/api/desoneracoes/documentos/${d2.id}" target="_blank" title="Visualizar">👁</a>
          <a class="btn small" href="/api/desoneracoes/documentos/${d2.id}" download="${UI.escapeHtml(d2.nome)}" title="Baixar">⬇</a>
          ${isStaff ? `<button class="btn small danger" data-doc-del="${d2.id}" title="Excluir">x</button>` : ''}
        </div>`).join('')}
      </div>`).join('');
    // Quem pode anexar? Saygo/Escritório sempre; demais (despachante, cliente) se podeAtuar na etapa atual
    const cur = (d.steps || []).find(s => s.etapa === d.currentStep);
    const podeAnexar = isStaff || cur?.podeAtuar;
    return `<div class="panel" style="margin-top:.6rem">
      <h3>Documentos</h3>
      ${html || '<div class="muted small">Nenhum documento anexado.</div>'}
      ${podeAnexar && d.status === 'EM_ANDAMENTO' ? `
        <div style="display:flex;gap:.5rem;margin-top:.5rem;align-items:center;flex-wrap:wrap">
          <select id="doc-tipo">${TIPOS.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
          <label class="btn primary" style="cursor:pointer">📎 Anexar
            <input type="file" id="doc-upload" style="display:none" accept=".pdf,.xml,image/*,.zip">
          </label>
        </div>` : ''}
    </div>`;
  }

  function renderHistorico(d) {
    const eventos = (d.eventos || []).slice(0, 20);
    if (!eventos.length) return '';
    return `<div class="panel" style="margin-top:.6rem">
      <h3>Histórico</h3>
      <div style="font-size:12px">
        ${eventos.map(e => `<div style="padding:3px 0;border-bottom:1px dashed var(--bd)">
          <strong>${UI.escapeHtml(e.acao)}</strong> · ${UI.fmtDateTime(e.createdAt)} · ${UI.escapeHtml(e.byUser?.name||'—')}
          ${e.descricao ? `<div class="muted small">${UI.escapeHtml(e.descricao)}</div>` : ''}
        </div>`).join('')}
      </div>
    </div>`;
  }

  function bindDetailActions(d, isStaff) {
    const id = d.id;
    // Avançar etapa
    document.getElementById('des-advance-btn')?.addEventListener('click', async () => {
      const parc = document.getElementById('step-parc')?.value || null;
      try {
        await API.post(`/api/desoneracoes/${id}/advance`, { parceiroId: parc });
        UI.toast('Etapa avançada');
        openDetail(id); render();
      } catch (e) { UI.toast(e.message, 'err'); }
    });
    // Cancelar
    document.getElementById('des-cancel-btn')?.addEventListener('click', async () => {
      const reason = prompt('Motivo do cancelamento (opcional):');
      if (reason === null) return;
      try { await API.post(`/api/desoneracoes/${id}/cancel`, { reason }); UI.toast('Cancelada'); UI.closeModal(); render(); }
      catch (e) { UI.toast(e.message, 'err'); }
    });
    // Aprovar
    document.getElementById('des-approve-btn')?.addEventListener('click', async () => {
      if (!confirm('Aprovar e criar a movimentação de Débito de Liquidação no extrato do cliente?')) return;
      try {
        await API.post(`/api/desoneracoes/${id}/approve`);
        UI.toast('Movimentação criada — desoneração concluída'); UI.closeModal(); render();
      } catch (e) { UI.toast(e.message, 'err'); }
    });
    // Adicionar NF
    document.getElementById('nf-add')?.addEventListener('click', () => {
      const tipo = prompt('Tipo (ENTRADA ou SAIDA):', 'ENTRADA');
      if (!tipo) return;
      const numero = prompt('Número da NF:');
      if (!numero) return;
      const valor = prompt('Valor (R$):', '0');
      const data = prompt('Data de emissão (YYYY-MM-DD, opcional):');
      API.post(`/api/desoneracoes/${id}/notas`, { tipo: tipo.toUpperCase(), numero, valor: Number(valor)||0, dataEmissao: data || null })
        .then(() => { UI.toast('NF adicionada'); openDetail(id); })
        .catch(e => UI.toast(e.message, 'err'));
    });
    // Validar NF
    document.querySelectorAll('[data-nf-validar]').forEach(b => b.onclick = async () => {
      try { await API.post(`/api/desoneracoes/notas/${b.dataset.nfValidar}/validar`); openDetail(id); }
      catch (e) { UI.toast(e.message, 'err'); }
    });
    // Excluir NF
    document.querySelectorAll('[data-nf-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Excluir NF?')) return;
      try { await API.del(`/api/desoneracoes/notas/${b.dataset.nfDel}`); openDetail(id); }
      catch (e) { UI.toast(e.message, 'err'); }
    });
    // Anexar oficial em NF
    document.querySelectorAll('[data-nf-oficial]').forEach(inp => inp.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const resp = await fetch(`/api/desoneracoes/notas/${inp.dataset.nfOficial}/oficial`, { method: 'POST', credentials: 'include', body: fd });
        if (!resp.ok) throw new Error(await resp.text());
        UI.toast('PDF oficial anexado'); openDetail(id);
      } catch (e2) { UI.toast(e2.message, 'err'); }
    });
    // Upload documento
    document.getElementById('doc-upload')?.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const tipo = document.getElementById('doc-tipo').value;
      const fd = new FormData();
      fd.append('file', file); fd.append('tipo', tipo);
      try {
        const resp = await fetch(`/api/desoneracoes/${id}/documentos`, { method: 'POST', credentials: 'include', body: fd });
        if (!resp.ok) throw new Error(await resp.text());
        UI.toast('Documento anexado'); openDetail(id);
      } catch (e2) { UI.toast(e2.message, 'err'); }
    });
    // Excluir doc
    document.querySelectorAll('[data-doc-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Excluir documento?')) return;
      try { await API.del(`/api/desoneracoes/documentos/${b.dataset.docDel}`); openDetail(id); }
      catch (e) { UI.toast(e.message, 'err'); }
    });
    // Mudar parceiro responsável da etapa atual (auto-save ao mudar)
    document.getElementById('step-parc')?.addEventListener('change', async e => {
      try { await API.post(`/api/desoneracoes/${id}/step/${d.currentStep}`, { parceiroId: e.target.value || null }); UI.toast('Parceiro atualizado'); }
      catch (er) { UI.toast(er.message, 'err'); }
    });
  }

  return { render };
})();
