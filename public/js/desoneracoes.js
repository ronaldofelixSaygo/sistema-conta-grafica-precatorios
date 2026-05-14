window.VIEW_desoneracoes = (() => {
  let listCache = [];
  let parceirosCache = [];
  let clientesCache = [];

  // ENVIO_NF_OFICIAL foi removida do fluxo. A re-anexação de NFs rejeitadas
  // acontece dentro da EMISSAO_NF (volta pra etapa 3 quando há rejeitada).
  const STEP_LABELS = {
    DOCS_DESPACHANTE:  '1. Docs do Despachante',
    EMISSAO_DMI:       '2. Emissão DMI',
    EMISSAO_NF:        '3. Emissão NFs',
    VALIDACAO_NF:      '4. Validação NFs',
    PROTOCOLO_ICMS:    '5. Protocolo ICMS',
    CONCLUIDO:         '✓ Concluído',
  };
  const STEP_ORDER = ['DOCS_DESPACHANTE','EMISSAO_DMI','EMISSAO_NF','VALIDACAO_NF','PROTOCOLO_ICMS'];
  const ETAPA_DOC_TIPOS = {
    DOCS_DESPACHANTE: ['DUIMP','PL','PI','AFRMM','BL','CCT','OUTRO'],
    EMISSAO_DMI:      ['DMI','OUTRO'],
    EMISSAO_NF:       ['OUTRO'],
    VALIDACAO_NF:     ['OUTRO'],
    PROTOCOLO_ICMS:   ['DESPACHO','OUTRO'],
  };
  function isStepReached(d, target) {
    // True se a desoneração já alcançou (ou passou) a etapa "target"
    if (d.status === 'CONCLUIDA' || d.status === 'AGUARDANDO_APROVACAO') return true;
    const curIdx = STEP_ORDER.indexOf(d.currentStep);
    const tgtIdx = STEP_ORDER.indexOf(target);
    return curIdx >= tgtIdx;
  }

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
    // REGRA: só CLIENTE (do próprio cadastro) ou STAFF (ADM/SAYGO) podem criar
    // uma nova desoneração. Parceiros só atuam nas etapas atribuídas a eles.
    const canCreate = AUTH.isStaff() || AUTH.role() === 'CLIENT';
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
    UI.openModal('Nova desoneração', `
      <form id="form-des" class="form-grid">
        <div class="full"><label>Cliente *</label>
          <select name="clienteId" required><option value="">—</option>
            ${clientesCache.map(c => `<option value="${c.id}">${UI.escapeHtml(c.nome)}</option>`).join('')}
          </select>
          <div class="muted small" style="margin-top:.2rem">O escritório responsável e o despachante são vinculados automaticamente pelo cadastro do cliente.</div>
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
        <div><label>Valor mercadoria (R$)</label><input type="number" step="0.01" name="valorMercadoria" placeholder="opcional"></div>
        <div class="full muted small" style="border-top:1px solid var(--bd);padding-top:.4rem;margin-top:.2rem">
          ℹ O <strong>valor do ICMS a desonerar</strong> é preenchido na etapa <strong>Emissão DMI</strong>, quando o escritório devolve a DMI com o valor calculado.
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
      const payload = {
        clienteId: Number(fd.get('clienteId')),
        modal: fd.get('modal'),
        duimpDi: fd.get('duimpDi') || null,
        numeroProcesso: fd.get('numeroProcesso') || null,
        valorMercadoria: fd.get('valorMercadoria') ? Number(fd.get('valorMercadoria')) : null,
        // Sem valorIcmsDesonerado nem parceiros — backend resolve automaticamente.
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
  // Tela de detalhe (modal grande, stepper horizontal)
  // ─────────────────────────────────────────────────────────────────────
  async function openDetail(id) {
    let d;
    try { d = await API.get(`/api/desoneracoes/${id}`); }
    catch (e) { return UI.toast(e.message, 'err'); }

    // ⚠ ATENÇÃO: isStaff aqui é só ADM/SAYGO. Antes incluía PARTNER ESCRITORIO,
    // o que vazava poderes que devem ser exclusivos do staff (excluir documento,
    // aprovar, trocar parceiro da etapa). Parceiros agem nas etapas deles via
    // `step.podeAtuar` retornado pelo backend.
    const isStaff = AUTH.isStaff();
    // Cliente dono do processo pode também cancelar e participar como solicitante.
    const isOwnerClient = AUTH.role() === 'CLIENT' && AUTH.user()?.clienteId === d.clienteId;
    const stepperHtml = renderStepperHorizontal(d);
    const painelHtml = renderPainel(d, isStaff, isOwnerClient);
    // NFs agora ficam integradas dentro de renderDocs (etapas 3-5).
    const docsHtml = renderDocs(d, isStaff);
    const histHtml = renderHistorico(d);

    UI.openModal(`Desoneração — ${UI.escapeHtml(d.cliente?.nome || '')}`, `
      <div class="muted small" style="margin-bottom:.6rem">
        ${UI.escapeHtml(d.cliente?.nome || '')} · DUIMP ${UI.escapeHtml(d.duimpDi || '—')} · Modal ${MODAL_LABELS[d.modal]} · ${statusPill(d.status)}
        ${d.valorIcmsDesonerado ? ` · ICMS desonerar: <strong>${UI.fmtMoney(d.valorIcmsDesonerado)}</strong>` : ''}
        ${d.cancelReason ? `<div class="err small" style="margin-top:.3rem">Cancelada: ${UI.escapeHtml(d.cancelReason)}</div>` : ''}
      </div>
      ${stepperHtml}
      <div style="display:flex;flex-direction:column;gap:1rem">
        ${painelHtml}
        ${docsHtml}
        ${histHtml}
      </div>`, { large: true });
    bindDetailActions(d, isStaff);
  }

  // Stepper horizontal — régua de etapas no topo
  function renderStepperHorizontal(d) {
    const all = [...STEP_ORDER, 'CONCLUIDO'];
    const items = all.map((etapa, i) => {
      const step = (d.steps || []).find(x => x.etapa === etapa);
      const done = step?.completedAt || (etapa === 'CONCLUIDO' && d.status === 'CONCLUIDA');
      const active = d.currentStep === etapa && d.status === 'EM_ANDAMENTO';
      const aguardando = etapa === 'CONCLUIDO' && d.status === 'AGUARDANDO_APROVACAO';
      const cls = done ? 'done' : (active || aguardando) ? 'active' : 'pending';
      const icon = done ? '✓' : (i + 1);
      const responsavel = renderRespLabel(d, step);
      return `<div class="step ${cls}">
        <div class="ico">${icon}</div>
        <div class="label">${STEP_LABELS[etapa]}</div>
        ${responsavel ? `<div class="sub">${responsavel}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="stepper-h">${items}</div>`;
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

  function renderPainel(d, isStaff, isOwnerClient = false) {
    const canCancel = isStaff || isOwnerClient;
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
        ${(isStaff || canCancel) ? `
          <div class="form-actions" style="margin-top:.6rem">
            ${canCancel ? '<button class="btn danger" id="des-cancel-btn">Cancelar desoneração</button>' : ''}
            ${isStaff ? '<button class="btn primary" id="des-approve-btn">✓ Aprovar e criar movimentação</button>' : ''}
          </div>` : ''}
      </div>`;
    }
    // EM_ANDAMENTO
    const cur = (d.steps || []).find(s => s.etapa === d.currentStep);
    const podeAvancar = !!cur?.podeAtuar;
    const respLabel = renderRespLabel(d, cur);
    // Painel especial: na etapa EMISSAO_DMI o responsável preenche o valor ICMS desonerado.
    const isEtapaDmi = d.currentStep === 'EMISSAO_DMI';
    return `<div class="panel">
      <h3>Etapa atual: ${STEP_LABELS[d.currentStep]}</h3>
      <div class="muted small" style="margin:.3rem 0">Responsável: <strong>${respLabel || '—'}</strong></div>
      ${isEtapaDmi ? `
        <div style="background:var(--s2);padding:.6rem .8rem;border-radius:6px;margin:.5rem 0">
          <label style="font-size:11px;text-transform:uppercase;color:var(--t3)">Valor ICMS a desonerar (R$) — vem da DMI devolvida pelo escritório</label>
          <input id="des-valor-icms" type="number" step="0.01" min="0" value="${d.valorIcmsDesonerado ?? ''}" style="width:100%;padding:8px 10px;background:var(--s1);border:1px solid var(--bd2);border-radius:6px" ${podeAvancar?'':'readonly'}>
          <div class="muted small" style="margin-top:.3rem">Obrigatório pra avançar dessa etapa. Será usado pra criar a movimentação no extrato do cliente ao concluir.</div>
        </div>
      ` : ''}
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
        ${canCancel ? '<button class="btn danger" id="des-cancel-btn">Cancelar processo</button>' : ''}
        ${podeAvancar ? '<button class="btn primary" id="des-advance-btn">Avançar etapa →</button>' : ''}
      </div>
      ${!podeAvancar ? `<div class="muted small" style="margin-top:.4rem">⚠ Esta etapa precisa ser avançada pelo responsável: <strong>${respLabel}</strong>.</div>` : ''}
      <div class="muted small" style="margin-top:.4rem">Documentos obrigatórios são verificados ao avançar.</div>
    </div>`;
  }

  function renderNotas(d, isStaff) {
    // Esta seção só faz sentido a partir da etapa EMISSAO_NF (etapa 3).
    // Antes disso, mostra apenas um aviso explicativo.
    const reached = isStepReached(d, 'EMISSAO_NF');
    if (!reached) {
      return `<div class="panel">
        <h3>Notas Fiscais</h3>
        <div class="muted small">⏳ Disponível após a etapa <strong>Emissão DMI</strong>. O cliente faz o upload das NFs aqui quando a DMI for devolvida pelo escritório.</div>
      </div>`;
    }

    const cur = (d.steps || []).find(s => s.etapa === d.currentStep);
    const podeAtuarAgora = !!cur?.podeAtuar || isStaff;
    const podeAdicionar = podeAtuarAgora && d.currentStep === 'EMISSAO_NF';
    const podeValidar   = podeAtuarAgora && d.currentStep === 'VALIDACAO_NF';
    // Exclusão: enquanto a etapa "Emissão NFs" estiver ativa (staff também)
    const podeRemover   = podeAtuarAgora && d.currentStep === 'EMISSAO_NF';

    const linhas = (d.notas || []).map(n => `
      <div class="doc-row">
        <div class="doc-tipo">NF</div>
        <div class="doc-file">
          <div class="doc-file-item">
            <span class="doc-name" title="${UI.escapeHtml(n.oficialNome || n.numero)}">📄 ${UI.escapeHtml(n.oficialNome || n.numero)}</span>
            ${(n.oficialBytes || n.oficialNome) ? `<a class="doc-download" href="/api/desoneracoes/notas/${n.id}/oficial" download="${UI.escapeHtml(n.oficialNome||'nf.pdf')}" title="Baixar">⬇</a>` : ''}
          </div>
          ${n.validada ? '<span class="pill green small" style="margin-top:.2rem">Validada</span>' : ''}
        </div>
        <div class="doc-actions">
          ${(n.oficialBytes || n.oficialNome) ? `<button class="btn small" data-nf-view="${n.id}" data-nf-name="${UI.escapeHtml(n.oficialNome||'nf.pdf')}" title="Visualizar">👁</button>` : ''}
          ${podeValidar && !n.validada ? `<button class="btn small" data-nf-validar="${n.id}" title="Validar">✓</button>` : ''}
          ${podeRemover ? `<button class="btn small danger" data-nf-del="${n.id}" title="Excluir">✕</button>` : ''}
        </div>
      </div>`).join('');
    return `<div class="panel">
      <h3>Notas Fiscais</h3>
      ${d.notas?.length
        ? `<div class="doc-grid">${linhas}</div>`
        : '<div class="muted small">Sem NFs anexadas.</div>'}
      ${podeAdicionar ? `<div style="margin-top:.6rem">
        <label class="btn primary btn-anexar" style="cursor:pointer">
          📎 Anexar NF(s)
          <input type="file" id="nf-upload" multiple accept=".pdf,.xml,image/*" style="display:none">
        </label>
        <div class="muted small" style="margin-top:.3rem">Selecione 1 ou mais arquivos de NF. O parceiro escritório vai conferir e validar.</div>
      </div>` : ''}
    </div>`;
  }

  // Documentos previstos por ETAPA (linha-a-linha). CTE_AWB_BL unifica os
  // antigos BL e CCT — admin pode renomear/criar tipos novos em Parâmetros.
  const DOCS_PREVISTOS_POR_ETAPA = {
    DOCS_DESPACHANTE: ['DUIMP','PL','PI','AFRMM','CTE_AWB_BL'],
    EMISSAO_DMI:      ['DMI'],
    PROTOCOLO_ICMS:   ['DESPACHO'],
  };
  function renderDocs(d, isStaff) {
    const docs = d.documentos || [];
    const cur = (d.steps || []).find(s => s.etapa === d.currentStep);
    const podeAtuarAgora = (isStaff || cur?.podeAtuar) && d.status === 'EM_ANDAMENTO';

    const rowsByEtapa = {};
    for (const etapa of ['DOCS_DESPACHANTE','EMISSAO_DMI','PROTOCOLO_ICMS']) {
      rowsByEtapa[etapa] = [...DOCS_PREVISTOS_POR_ETAPA[etapa]];
    }

    function renderLinha(etapa, tipo) {
      const reached = isStepReached(d, etapa);
      const isCurrent = d.currentStep === etapa;
      const arquivos = docs.filter(x => x.tipo === tipo);
      const tem = arquivos.length > 0;
      const podeAnexarNessaEtapa = isCurrent && podeAtuarAgora;
      // Excluir: quem pode atuar na etapa atual também pode excluir o que ele
      // (ou outro responsável) anexou — enquanto a etapa não foi avançada.
      const podeExcluir = isCurrent && podeAtuarAgora && d.status === 'EM_ANDAMENTO';

      const disabled = !reached && !tem;
      const statusText = !reached ? (isCurrent ? 'Aguardando anexo' : '⏳ Aguardando etapa anterior')
                       : tem ? '' : (isCurrent ? 'Aguardando anexo' : 'Não anexado');

      // Bloco do(s) arquivo(s): nome + ícone de download inline
      const arquivosHtml = arquivos.length
        ? arquivos.map(a => `
            <div class="doc-file-item">
              <span class="doc-name" title="${UI.escapeHtml(a.nome)}">📄 ${UI.escapeHtml(a.nome)}</span>
              <a class="doc-download" href="/api/desoneracoes/documentos/${a.id}" download="${UI.escapeHtml(a.nome)}" title="Baixar">⬇</a>
            </div>`).join('')
        : `<span class="muted small">${statusText || '—'}</span>`;

      // Ações fixas à direita
      const acoesHtml = (() => {
        if (!reached) return ''; // etapa futura: nenhum botão
        const primeiro = arquivos[0];
        return `
          ${tem ? `<button class="btn small" data-doc-view="${primeiro.id}" data-doc-name="${UI.escapeHtml(primeiro.nome)}" title="Visualizar">👁</button>` : ''}
          ${tem && podeExcluir ? `<button class="btn small danger" data-doc-del="${primeiro.id}" title="Excluir">✕</button>` : ''}
          ${podeAnexarNessaEtapa ? `
            <label class="btn primary small btn-anexar" style="cursor:pointer" title="${tem?'Adicionar outro':'Anexar'} ${tipo}">
              📎 ${tem?'Adicionar':'Anexar'}
              <input type="file" data-doc-upload="${tipo}" style="display:none" accept=".pdf,.xml,image/*,.zip">
            </label>` : ''}`;
      })();

      return `<div class="doc-row ${disabled?'disabled':''}">
        <div class="doc-tipo">${tipo}</div>
        <div class="doc-file">${arquivosHtml}</div>
        <div class="doc-actions">${acoesHtml}</div>
      </div>`;
    }

    // 5 etapas operacionais. EMISSAO_NF (3) e VALIDACAO_NF (4) ficam entre
    // EMISSAO_DMI e PROTOCOLO_ICMS. Re-anexo de NF rejeitada acontece dentro
    // da própria EMISSAO_NF — o fluxo volta pra etapa 3 quando o parceiro
    // rejeita alguma NF na etapa 4.
    const todasEtapas = [
      'DOCS_DESPACHANTE','EMISSAO_DMI',
      'EMISSAO_NF','VALIDACAO_NF',
      'PROTOCOLO_ICMS',
    ];
    const sections = todasEtapas.map(etapa => {
      const conteudo = ['EMISSAO_NF','VALIDACAO_NF'].includes(etapa)
        ? renderEtapaNotas(d, etapa, isStaff, podeAtuarAgora)
        : `<div class="doc-grid">${rowsByEtapa[etapa].map(t => renderLinha(etapa, t)).join('')}</div>`;
      return `<div style="margin-bottom:.6rem">
        <div class="muted small" style="text-transform:uppercase;font-weight:600;margin-bottom:.3rem">${STEP_LABELS[etapa]}</div>
        ${conteudo}
      </div>`;
    }).join('');

    return `<div class="panel">
      <h3>Documentos</h3>
      ${sections}
    </div>`;
  }

  // Renderiza uma etapa de NF como linha-padrão (mesmo visual dos docs).
  // EMISSAO_NF (3): cliente sobe NFs. Se voltou aqui depois da etapa 4 com
  //                 alguma NF rejeitada, mostra o motivo bem visível e
  //                 permite excluir as rejeitadas + anexar novas.
  // VALIDACAO_NF (4): parceiro escritório valida (✓) ou rejeita (✗) cada NF.
  //                   Rejeitar exige motivo (prompt) que fica visível.
  function renderEtapaNotas(d, etapa, isStaff, podeAtuarAgora) {
    const reached = isStepReached(d, etapa);
    if (!reached) {
      return `<div class="doc-grid"><div class="doc-row disabled">
        <div class="doc-tipo">NF</div>
        <div class="doc-file"><span class="muted small">⏳ Aguardando etapa anterior</span></div>
        <div class="doc-actions"></div>
      </div></div>`;
    }
    const cur = (d.steps || []).find(s => s.etapa === d.currentStep);
    const isCurrent = d.currentStep === etapa;
    const ativo = !!cur?.podeAtuar || isStaff;
    const notas = d.notas || [];
    const temRejeitada = notas.some(n => n.rejeitada);

    // Cliente / staff pode anexar e excluir só durante a EMISSAO_NF ativa.
    // Re-anexação após rejeição acontece DEPOIS do parceiro clicar
    // "Devolver pro cliente" (volta a etapa 3 explicitamente).
    const canEditNFsAgora = d.status === 'EM_ANDAMENTO' && etapa === 'EMISSAO_NF' && isCurrent && ativo;
    const podeAdicionar = canEditNFsAgora;
    const podeRemover   = canEditNFsAgora;
    const podeValidar   = ativo && etapa === 'VALIDACAO_NF' && isCurrent;
    const podeRejeitar  = ativo && etapa === 'VALIDACAO_NF' && isCurrent;

    if (!notas.length && !podeAdicionar) {
      return `<div class="doc-grid"><div class="doc-row disabled">
        <div class="doc-tipo">NF</div>
        <div class="doc-file"><span class="muted small">${etapa === 'EMISSAO_NF' ? 'Aguardando anexo' : 'Sem NFs anexadas'}</span></div>
        <div class="doc-actions"></div>
      </div></div>`;
    }

    const linhas = notas.map(n => {
      const statusBlock = n.rejeitada
        ? `<div style="margin-top:.3rem">
             <span class="pill red" style="font-size:10px">Rejeitada</span>
             ${n.rejeitadaMotivo ? `<div class="nf-motivo">⚠ <strong>Motivo:</strong> ${UI.escapeHtml(n.rejeitadaMotivo)}</div>` : ''}
           </div>`
        : n.validada
          ? '<span class="pill green" style="margin-top:.2rem;font-size:10px;display:inline-block">Validada</span>'
          : '';
      const tipoLabel = n.tipo === 'SAIDA' ? 'NF-S' : 'NF-E';
      return `
      <div class="doc-row ${n.rejeitada?'rejeitada':''}">
        <div class="doc-tipo">${tipoLabel}</div>
        <div class="doc-file">
          <div class="doc-file-item">
            <span class="doc-name" title="${UI.escapeHtml(n.oficialNome || n.numero)}">📄 ${UI.escapeHtml(n.oficialNome || n.numero)}</span>
            ${(n.oficialBytes || n.oficialNome) ? `<a class="doc-download" href="/api/desoneracoes/notas/${n.id}/oficial" download="${UI.escapeHtml(n.oficialNome||'nf.pdf')}" title="Baixar">⬇</a>` : ''}
          </div>
          ${statusBlock}
        </div>
        <div class="doc-actions">
          ${(n.oficialBytes || n.oficialNome) ? `<button class="btn small" data-nf-view="${n.id}" data-nf-name="${UI.escapeHtml(n.oficialNome||'nf.pdf')}" title="Visualizar">👁</button>` : ''}
          ${podeValidar && !n.validada ? `<button class="btn small" data-nf-validar="${n.id}" title="Validar">✓</button>` : ''}
          ${podeRejeitar && !n.rejeitada ? `<button class="btn small danger" data-nf-rejeitar="${n.id}" title="Rejeitar">✗</button>` : ''}
          ${podeRemover ? `<button class="btn small danger" data-nf-del="${n.id}" title="Excluir">✕</button>` : ''}
        </div>
      </div>`;
    }).join('');

    // Aviso visível na etapa 3 quando o cliente voltou aqui por NFs rejeitadas
    const avisoRetorno = (etapa === 'EMISSAO_NF' && isCurrent && temRejeitada)
      ? `<div class="aviso-rejeicao">⚠ <strong>NFs rejeitadas pelo parceiro</strong> — exclua as rejeitadas e anexe as corretas antes de avançar.</div>`
      : '';
    // Aviso pro parceiro na etapa 4: bloqueio de avanço quando há rejeitada
    const avisoBloqueio = (etapa === 'VALIDACAO_NF' && isCurrent && temRejeitada)
      ? `<div class="aviso-rejeicao">⚠ Há NFs rejeitadas — você precisa clicar em "Devolver pro cliente" pra esta etapa voltar pra ele substituir os arquivos.</div>`
      : '';

    const hint = etapa === 'EMISSAO_NF'
      ? (temRejeitada
          ? 'Substitua as NFs rejeitadas. Mínimo: 1 NF de Entrada e 1 NF de Saída.'
          : 'Anexe pelo menos 1 NF de Entrada e 1 NF de Saída.')
      : 'Aprove (✓) ou rejeite (✗) cada NF. Para avançar: nenhuma rejeitada + pelo menos 1 NF-E e 1 NF-S validadas.';

    // 2 botões dedicados (Entrada / Saída) na etapa 3
    const adicionarHtml = podeAdicionar ? `
      <div style="margin-top:.4rem;display:flex;gap:.4rem;flex-wrap:wrap">
        <label class="btn primary small btn-anexar" style="cursor:pointer">
          📎 Anexar NF de Entrada
          <input type="file" data-nf-upload-tipo="ENTRADA" multiple accept=".pdf,.xml,image/*" style="display:none">
        </label>
        <label class="btn primary small btn-anexar" style="cursor:pointer">
          📎 Anexar NF de Saída
          <input type="file" data-nf-upload-tipo="SAIDA" multiple accept=".pdf,.xml,image/*" style="display:none">
        </label>
      </div>
      <div class="muted small" style="margin-top:.3rem">${hint}</div>` : (isCurrent ? `<div class="muted small" style="margin-top:.3rem">${hint}</div>` : '');

    // Botão "Devolver pro cliente" — só pro parceiro na etapa 4 quando há rejeitada
    const devolverHtml = (etapa === 'VALIDACAO_NF' && isCurrent && temRejeitada && ativo)
      ? `<div style="margin-top:.5rem">
           <button class="btn danger small" id="nf-devolver">↩ Devolver pro cliente</button>
         </div>` : '';

    return `${avisoRetorno}${avisoBloqueio}<div class="doc-grid">${linhas || ''}</div>${adicionarHtml}${devolverHtml}`;
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
      // Se está na etapa DMI, salva o valor ICMS antes de avançar (responsável preencheu).
      if (d.currentStep === 'EMISSAO_DMI') {
        const inp = document.getElementById('des-valor-icms');
        const valor = inp ? Number(inp.value) : 0;
        if (!valor || valor <= 0) { UI.toast('Informe o Valor ICMS a desonerar (vem da DMI)', 'err'); return; }
        try { await API.put(`/api/desoneracoes/${id}`, { valorIcmsDesonerado: valor }); }
        catch (e) { UI.toast('Falha ao salvar valor ICMS: ' + e.message, 'err'); return; }
      }
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
    // Upload de NFs por tipo (Entrada / Saída). Cada input tem data-nf-upload-tipo.
    document.querySelectorAll('[data-nf-upload-tipo]').forEach(inp => inp.addEventListener('change', async e => {
      const files = [...(e.target.files || [])];
      if (!files.length) return;
      const tipo = e.target.dataset.nfUploadTipo || 'ENTRADA';
      let ok = 0, fail = 0;
      for (let i = 0; i < files.length; i++) {
        UI.toast(`Enviando NF-${tipo==='SAIDA'?'S':'E'} ${i+1}/${files.length}: ${files[i].name}`);
        const fd = new FormData();
        fd.append('file', files[i]);
        fd.append('tipo', tipo);
        try {
          const r = await fetch(`/api/desoneracoes/${id}/notas/upload`, { method: 'POST', credentials: 'include', body: fd });
          if (!r.ok) throw new Error(await r.text() || 'Falha no upload');
          ok++;
        } catch (er) { fail++; UI.toast(`Falhou ${files[i].name}: ${er.message}`, 'err'); }
      }
      UI.toast(fail === 0 ? `✓ ${ok} NF(s) ${tipo} anexada(s)` : `${ok} ok, ${fail} falha(s)`, fail === 0 ? 'ok' : 'err');
      openDetail(id);
    }));
    // Botão "Devolver pro cliente" na etapa 4
    document.getElementById('nf-devolver')?.addEventListener('click', async () => {
      if (!confirm('Devolver o processo pro cliente substituir as NFs rejeitadas?')) return;
      try {
        await API.post(`/api/desoneracoes/${id}/devolver-nfs`);
        UI.toast('Devolvido pro cliente');
        openDetail(id); render();
      } catch (e) { UI.toast(e.message, 'err'); }
    });
    // Validar NF
    document.querySelectorAll('[data-nf-validar]').forEach(b => b.onclick = async () => {
      try { await API.post(`/api/desoneracoes/notas/${b.dataset.nfValidar}/validar`); openDetail(id); }
      catch (e) { UI.toast(e.message, 'err'); }
    });
    // Rejeitar NF (parceiro escritório na etapa VALIDACAO_NF)
    document.querySelectorAll('[data-nf-rejeitar]').forEach(b => b.onclick = async () => {
      const motivo = prompt('Motivo da rejeição (opcional, mas ajuda o cliente):', '');
      if (motivo === null) return;
      try { await API.post(`/api/desoneracoes/notas/${b.dataset.nfRejeitar}/rejeitar`, { motivo: motivo || null }); openDetail(id); }
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
    // Upload documento — agora cada linha tem seu próprio input com data-doc-upload="TIPO"
    document.querySelectorAll('[data-doc-upload]').forEach(inp => inp.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      const tipo = inp.dataset.docUpload;
      const fd = new FormData();
      fd.append('file', file); fd.append('tipo', tipo);
      try {
        const resp = await fetch(`/api/desoneracoes/${id}/documentos`, { method: 'POST', credentials: 'include', body: fd });
        if (!resp.ok) {
          const txt = await resp.text();
          let msg = txt;
          try { msg = JSON.parse(txt).error || msg; } catch {}
          throw new Error(msg);
        }
        UI.toast(`${tipo} anexado`); openDetail(id);
      } catch (e2) { UI.toast(e2.message, 'err'); }
    });
    // Excluir doc
    document.querySelectorAll('[data-doc-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Excluir documento?')) return;
      try { await API.del(`/api/desoneracoes/documentos/${b.dataset.docDel}`); openDetail(id); }
      catch (e) { UI.toast(e.message, 'err'); }
    });
    // Visualizar doc inline (usa o VIEWER do viewer.js — overlay com iframe pra PDF)
    document.querySelectorAll('[data-doc-view]').forEach(b => b.onclick = () => {
      VIEWER.open({
        url: `/api/desoneracoes/documentos/${b.dataset.docView}`,
        filename: b.dataset.docName,
      });
    });
    // Visualizar NF oficial inline
    document.querySelectorAll('[data-nf-view]').forEach(b => b.onclick = () => {
      VIEWER.open({
        url: `/api/desoneracoes/notas/${b.dataset.nfView}/oficial`,
        filename: b.dataset.nfName,
      });
    });
    // Mudar parceiro responsável da etapa atual (auto-save ao mudar)
    document.getElementById('step-parc')?.addEventListener('change', async e => {
      try { await API.post(`/api/desoneracoes/${id}/step/${d.currentStep}`, { parceiroId: e.target.value || null }); UI.toast('Parceiro atualizado'); }
      catch (er) { UI.toast(er.message, 'err'); }
    });
  }

  return { render };
})();
