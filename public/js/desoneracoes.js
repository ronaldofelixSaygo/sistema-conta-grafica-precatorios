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
  const ETAPA_DOC_TIPOS = {
    DOCS_DESPACHANTE: ['DUIMP','PL','PI','AFRMM','BL','CCT','OUTRO'],
    EMISSAO_DMI:      ['DMI','OUTRO'],
    EMISSAO_NF:       ['OUTRO'],
    VALIDACAO_NF:     ['OUTRO'],
    ENVIO_NF_OFICIAL: ['OUTRO'],
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

    const isStaff = AUTH.isStaff() || AUTH.isPartnerEscritorio();
    const stepperHtml = renderStepperHorizontal(d);
    const painelHtml = renderPainel(d, isStaff);
    const notasHtml = renderNotas(d, isStaff);
    const docsHtml = renderDocs(d, isStaff);
    const histHtml = renderHistorico(d);

    UI.openModal(`Desoneração — ${UI.escapeHtml(d.cliente?.nome || '')}`, `
      <div class="muted small" style="margin-bottom:.6rem">
        ${UI.escapeHtml(d.cliente?.nome || '')} · DUIMP ${UI.escapeHtml(d.duimpDi || '—')} · Modal ${MODAL_LABELS[d.modal]} · ${statusPill(d.status)}
        ${d.valorIcmsDesonerado ? ` · ICMS desonerar: <strong>${UI.fmtMoney(d.valorIcmsDesonerado)}</strong>` : ''}
        ${d.cancelReason ? `<div class="err small" style="margin-top:.3rem">Cancelada: ${UI.escapeHtml(d.cancelReason)}</div>` : ''}
      </div>
      ${stepperHtml}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;align-items:flex-start">
        <div>
          ${painelHtml}
          ${notasHtml}
        </div>
        <div>
          ${docsHtml}
          ${histHtml}
        </div>
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
        ${isStaff ? '<button class="btn danger" id="des-cancel-btn">Cancelar processo</button>' : ''}
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
      return `<div class="panel" style="margin-top:.6rem">
        <h3>Notas Fiscais</h3>
        <div class="muted small">⏳ Disponível após a etapa <strong>Emissão DMI</strong>. O cliente cadastra as NFs aqui quando a DMI for devolvida pelo escritório.</div>
      </div>`;
    }

    const cur = (d.steps || []).find(s => s.etapa === d.currentStep);
    const podeAtuarAgora = !!cur?.podeAtuar || isStaff;
    const podeAdicionar = podeAtuarAgora && d.currentStep === 'EMISSAO_NF';
    const podeValidar   = podeAtuarAgora && d.currentStep === 'VALIDACAO_NF';
    const podeOficial   = podeAtuarAgora && d.currentStep === 'ENVIO_NF_OFICIAL';
    const podeRemover   = isStaff && d.currentStep === 'EMISSAO_NF';

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
        <td>
          ${podeValidar && !n.validada ? `<button class="btn small" data-nf-validar="${n.id}">Validar</button>` : ''}
          ${podeOficial ? `<label class="btn small" style="cursor:pointer" title="Anexar oficial">📎<input type="file" data-nf-oficial="${n.id}" style="display:none" accept=".pdf,.xml,image/*"></label>` : ''}
          ${podeRemover ? `<button class="btn small danger" data-nf-del="${n.id}">x</button>` : ''}
        </td>
      </tr>`).join('');
    return `<div class="panel" style="margin-top:.6rem">
      <h3>Notas Fiscais</h3>
      ${linhas ? `<table class="table"><thead><tr>
        <th>Tipo</th><th>Número</th><th>Data</th><th>Valor</th><th>Validação</th><th>Oficial</th><th></th>
      </tr></thead><tbody>${linhas}</tbody></table>` : '<div class="muted small">Sem NFs cadastradas.</div>'}
      ${podeAdicionar ? '<div style="margin-top:.5rem"><button class="btn" id="nf-add">+ Adicionar NF</button></div>' : ''}
    </div>`;
  }

  // Documentos previstos por ETAPA (linha-a-linha). A ordem aqui define a
  // sequência visual. OUTRO é sempre opcional/extra e fica no fim quando aplicável.
  const DOCS_PREVISTOS_POR_ETAPA = {
    DOCS_DESPACHANTE: ['DUIMP','PL','PI','AFRMM','BL'],  // CCT é condicional ao modal
    EMISSAO_DMI:      ['DMI'],
    PROTOCOLO_ICMS:   ['DESPACHO'],
  };
  function renderDocs(d, isStaff) {
    const docs = d.documentos || [];
    const cur = (d.steps || []).find(s => s.etapa === d.currentStep);
    const podeAtuarAgora = (isStaff || cur?.podeAtuar) && d.status === 'EM_ANDAMENTO';

    // Lista de "linhas a renderizar": uma por tipo previsto em cada etapa documental.
    const rowsByEtapa = {};
    for (const etapa of ['DOCS_DESPACHANTE','EMISSAO_DMI','PROTOCOLO_ICMS']) {
      const previstos = [...DOCS_PREVISTOS_POR_ETAPA[etapa]];
      // CCT é obrigatório só pra modal AEREO. Em outros modais aparece também
      // mas como opcional (linha cinza com botão Anexar).
      if (etapa === 'DOCS_DESPACHANTE' && d.modal === 'AEREO') previstos.push('CCT');
      else if (etapa === 'DOCS_DESPACHANTE') previstos.push('CCT'); // opcional
      rowsByEtapa[etapa] = previstos;
    }

    function renderLinha(etapa, tipo) {
      const reached = isStepReached(d, etapa);
      const isCurrent = d.currentStep === etapa;
      const arquivos = docs.filter(x => x.tipo === tipo);
      const tem = arquivos.length > 0;
      const podeAnexarNessaEtapa = isCurrent && podeAtuarAgora;
      const podeExcluir = isStaff && isCurrent && d.status === 'EM_ANDAMENTO';

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
          ${tem ? `<a class="btn small" href="/api/desoneracoes/documentos/${primeiro.id}" target="_blank" title="Visualizar">👁</a>` : ''}
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

    // Renderiza separado por etapa com cabeçalho leve
    const sections = ['DOCS_DESPACHANTE','EMISSAO_DMI','PROTOCOLO_ICMS'].map(etapa => {
      const linhas = rowsByEtapa[etapa].map(t => renderLinha(etapa, t)).join('');
      return `<div style="margin-bottom:.6rem">
        <div class="muted small" style="text-transform:uppercase;font-weight:600;margin-bottom:.3rem">${STEP_LABELS[etapa]}</div>
        <div class="doc-grid">${linhas}</div>
      </div>`;
    }).join('');

    return `<div class="panel">
      <h3>Documentos</h3>
      ${sections}
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
    // Mudar parceiro responsável da etapa atual (auto-save ao mudar)
    document.getElementById('step-parc')?.addEventListener('change', async e => {
      try { await API.post(`/api/desoneracoes/${id}/step/${d.currentStep}`, { parceiroId: e.target.value || null }); UI.toast('Parceiro atualizado'); }
      catch (er) { UI.toast(er.message, 'err'); }
    });
  }

  return { render };
})();
