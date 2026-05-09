// =====================================================================
// Solicitação de Créditos — simulador de invoice (manual + PDF/IA)
// =====================================================================
window['VIEW_credit-requests'] = (() => {
  let clientesCache = [];
  let lastCalc = null;

  async function render() {
    const el = document.getElementById('view-credit-requests');
    el.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      const [list, clientes] = await Promise.all([
        API.get('/api/credit-requests', null, { ttl: 30000 }),
        API.get('/api/clientes', null, { ttl: 60000 }).catch(() => []),
      ]);
      clientesCache = clientes;
      // Quem CRIA: CLIENT (próprio) ou SAYGO/ADM. PARTNER nunca cria — só resolve.
      const role = AUTH.role();
      const canCreate = role === 'CLIENT' || role === 'SAYGO' || role === 'ADM';
      el.innerHTML = `
        <div class="page-toolbar">
          <div class="muted small">${list.length} solicitação(ões)</div>
          <span style="flex:1"></span>
          ${canCreate ? `<button class="btn primary" id="cr-new">+ Nova solicitação</button>` : ''}
        </div>
        <div id="cr-list"></div>`;
      drawList(list);
      if (canCreate) document.getElementById('cr-new').onclick = openWizard;
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  function statusPill(s) {
    const c = { DRAFT:'amber', SENT:'blue', IN_PROGRESS:'amber', RESOLVED:'green', CANCELED:'red' };
    return `<span class="pill ${c[s]||'amber'}">${s}</span>`;
  }

  function drawList(list) {
    const el = document.getElementById('cr-list');
    if (!list.length) { el.innerHTML = '<div class="muted small" style="padding:1rem">Sem solicitações.</div>'; return; }
    el.innerHTML = UI.table({
      cols: [
        { label: 'Quando', get: r => UI.fmtDateTime(r.createdAt) },
        { label: 'Cliente', get: r => r.cliente?.nome },
        { label: 'Escritório', get: r => r.partnerOfficeName },
        { label: 'Modalidade', get: r => r.modalidade === 'AL_NF' ? 'Alagoas NF (4%)' : 'Alagoas Dif (1.2%)' },
        { label: 'Créditos', align: 'right', html: true, get: r => `<strong>${UI.fmtMoney(r.creditosACompar)}</strong>` },
        { label: 'Status', html: true, get: r => statusPill(r.status) },
        { label: '', html: true, get: r => `<button class="btn small" data-open="${r.id}">Abrir</button>` },
      ],
      rows: list,
    });
    el.onclick = e => {
      const id = e.target.getAttribute('data-open');
      if (id) openDetail(list.find(x => x.id === id));
    };
  }

  // ---------- Wizard de criação ----------
  function openWizard() {
    const role = AUTH.role();
    let cliOpts;
    if (role === 'CLIENT') {
      // CLIENT: vê só o próprio cliente (clientesCache deve ter apenas 1)
      const myCli = clientesCache[0];
      cliOpts = myCli
        ? `<option value="${myCli.id}" selected>${UI.escapeHtml(myCli.nome)}</option>`
        : '';
    } else {
      cliOpts = clientesCache.map(c =>
        `<option value="${c.id}">${UI.escapeHtml(c.nome)}${c.escritorio?` — ${UI.escapeHtml(c.escritorio)}`:''}</option>`
      ).join('');
    }
    UI.openModal('Nova solicitação de créditos', `
      <div style="display:flex;gap:.4rem;border-bottom:1px solid var(--bd);padding-bottom:.5rem;margin-bottom:1rem">
        <button class="btn primary" data-tab="manual">Preencher manualmente</button>
        <button class="btn"         data-tab="pdf">📄 Importar PDF (IA)</button>
      </div>
      <div id="cr-wiz-content"></div>`);
    UI.openModal._currentTab = 'manual';
    const root = document.getElementById('modal-body');
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      root.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('primary', x===b));
      if (b.dataset.tab === 'pdf') drawPdfTab(cliOpts);
      else drawManualTab(cliOpts);
    });
    drawManualTab(cliOpts);
  }

  function drawManualTab(cliOpts, prefill = {}) {
    // Pré-seleciona cliente quando vier do tab PDF
    const preselectedCliId = prefill._clienteId ? String(prefill._clienteId) : '';
    const cliOptsPicked = preselectedCliId
      ? cliOpts.replace(`value="${preselectedCliId}"`, `value="${preselectedCliId}" selected`)
      : cliOpts;
    document.getElementById('cr-wiz-content').innerHTML = `
      <form id="cr-form" class="form-grid">
        <div class="full"><label>Cliente *</label>
          <select name="clienteId" required><option value="">—</option>${cliOptsPicked}</select>
        </div>
        <div><label>NCM *</label><input name="ncm" required value="${UI.escapeHtml(prefill.ncm||'')}"></div>
        <div><label>UF *</label><input name="uf" required value="${UI.escapeHtml(prefill.uf||'AL')}" maxlength="2"></div>

        <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.4rem">
          <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Importador / Exportador</strong>
        </div>
        <div><label>Importador (Nome)</label><input name="importadorNome" value="${UI.escapeHtml(prefill.importadorNome||'')}"></div>
        <div><label>Importador (CNPJ)</label><input name="importadorCnpj" value="${UI.escapeHtml(prefill.importadorCnpj||'')}"></div>
        <div><label>Exportador (Nome)</label><input name="exportadorNome" value="${UI.escapeHtml(prefill.exportadorNome||'')}"></div>
        <div><label>Exportador (País)</label><input name="exportadorPais" value="${UI.escapeHtml(prefill.exportadorPais||'')}"></div>

        <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.4rem">
          <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Valores em USD</strong>
        </div>
        <div><label>Valor FOB (USD) *</label><input type="number" step="0.01" name="vmle_usd" required value="${prefill.vmle_usd ?? ''}"></div>
        <div><label>Frete (USD)</label><input type="number" step="0.01" name="frete_usd" value="${prefill.frete_usd ?? 0}"></div>
        <div><label>Seguro (USD)</label><input type="number" step="0.01" name="seguro_usd" value="${prefill.seguro_usd ?? 0}"></div>
        <div><label>Taxa câmbio (R$/USD) *</label><input type="number" step="0.0001" name="taxa_cambio" required value="${prefill.taxa_cambio ?? ''}"></div>

        <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.4rem">
          <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Alíquotas (%)</strong>
        </div>
        <div><label>II (%) *</label><input type="number" step="0.01" name="ii_aliq" required value="${prefill.ii_aliq ?? ''}"></div>
        <div><label>IPI (%)</label><input type="number" step="0.01" name="ipi_aliq" value="${prefill.ipi_aliq ?? 0}"></div>
        <div><label>PIS (%)</label><input type="number" step="0.01" name="pis_aliq" value="${prefill.pis_aliq ?? 2.1}"></div>
        <div><label>Cofins (%)</label><input type="number" step="0.01" name="cofins_aliq" value="${prefill.cofins_aliq ?? 9.65}"></div>
        <div><label>ICMS estado (%) *</label><input type="number" step="0.01" name="icms_aliq_estado" required value="${prefill.icms_aliq_estado ?? ''}"></div>

        <div><label>Siscomex (R$)</label><input type="number" step="0.01" name="siscomex" value="${prefill.siscomex ?? 154.23}"></div>
        <div><label>AFRMM (R$)</label><input type="number" step="0.01" name="afrmm" value="${prefill.afrmm ?? 0}"></div>
        <div><label>Antidumping (R$)</label><input type="number" step="0.01" name="antidumping" value="${prefill.antidumping ?? 0}"></div>

        <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.4rem">
          <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Modalidade</strong>
        </div>
        <div class="full"><label>Modalidade *</label>
          <select name="modalidade">
            <option value="AL_NF" selected>Alagoas NF (4%)</option>
            <option value="AL_DIF">Alagoas Diferencial (1.2%)</option>
          </select>
        </div>
        <div class="full"><label>Mensagem (opcional)</label><textarea name="message" rows="2"></textarea></div>

        <div class="full form-actions">
          <button type="button" class="btn" id="cr-calc">Calcular</button>
          <button type="submit" class="btn primary">Enviar para Saygo</button>
        </div>
      </form>
      <div id="cr-result"></div>`;

    const form = document.getElementById('cr-form');
    document.getElementById('cr-calc').onclick = async () => {
      const inputs = formInputs(form);
      try {
        const r = await API.post('/api/credit-requests/simulate', { inputs });
        lastCalc = r;
        drawResult(r);
      } catch (e) { UI.toast(e.message, 'err'); }
    };
    form.onsubmit = async ev => {
      ev.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      const inputs = formInputs(form);
      const fd = new FormData(form);
      const payload = {
        clienteId: fd.get('clienteId'),
        modalidade: fd.get('modalidade'),
        message: fd.get('message'),
        inputs: JSON.stringify(inputs),
        autoSend: 'true',  // já cria e envia numa request só
      };
      try {
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Enviando...'; }
        await API.post('/api/credit-requests', payload);
        UI.toast('Solicitação enviada para o interveniente'); UI.closeModal(); render();
      } catch (e) {
        UI.toast(e.message, 'err');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Enviar para o interveniente'; }
      }
    };
  }

  function formInputs(form) {
    const fd = new FormData(form);
    const get = k => fd.get(k);
    const num = k => Number(fd.get(k) || 0);
    return {
      importadorNome: get('importadorNome'), importadorCnpj: get('importadorCnpj'),
      exportadorNome: get('exportadorNome'), exportadorPais: get('exportadorPais'),
      ncm: get('ncm'), uf: get('uf'),
      vmle_usd: num('vmle_usd'), frete_usd: num('frete_usd'), seguro_usd: num('seguro_usd'),
      taxa_cambio: num('taxa_cambio'),
      ii_aliq: num('ii_aliq'), ipi_aliq: num('ipi_aliq'),
      pis_aliq: num('pis_aliq'), cofins_aliq: num('cofins_aliq'),
      icms_aliq_estado: num('icms_aliq_estado'),
      siscomex: num('siscomex'), afrmm: num('afrmm'), antidumping: num('antidumping'),
    };
  }

  function drawResult(r) {
    const out = document.getElementById('cr-result');
    if (!r) { out.innerHTML = ''; return; }
    if (!r.valid) {
      out.innerHTML = `<div class="err">${r.warnings.join('<br>')}</div>`;
      return;
    }
    const c = r.cenarios;
    out.innerHTML = `
      <div class="panel" style="margin-top:1rem">
        <h3>📊 Resultado do cálculo</h3>
        <table class="table"><tbody>
          <tr><td>Subtotal federal</td><td class="num"><strong>${UI.fmtMoney(r.breakdown.subtotal)}</strong></td></tr>
          <tr><td>ICMS atual (${(c.atual.aliq*100).toFixed(2)}%)</td><td class="num val-neg">${UI.fmtMoney(c.atual.icms)}</td></tr>
          <tr><td>Custo total atual</td><td class="num">${UI.fmtMoney(c.atual.custo_total)}</td></tr>
        </tbody></table>
      </div>
      <div class="panel">
        <h3>Cenário Alagoas NF 4% (por dentro)</h3>
        <table class="table"><tbody>
          <tr><td>Nota Fiscal AL</td><td class="num">${UI.fmtMoney(c.al_nf.custo_total)}</td></tr>
          <tr><td>ICMS AL (créditos a comprar)</td><td class="num"><strong class="val-pos">${UI.fmtMoney(c.al_nf.icms)}</strong></td></tr>
          <tr><td>Economia vs atual</td><td class="num val-pos">${UI.fmtMoney(c.al_nf.economia)}</td></tr>
          <tr><td>Redução de ICMS</td><td class="num val-pos">${UI.fmtMoney(c.al_nf.reducao_icms)}</td></tr>
        </tbody></table>
      </div>
      <div class="panel">
        <h3>Cenário Alagoas Dif 1.2% (por dentro)</h3>
        <table class="table"><tbody>
          <tr><td>Nota Fiscal AL</td><td class="num">${UI.fmtMoney(c.al_dif.custo_total)}</td></tr>
          <tr><td>ICMS AL (créditos a comprar)</td><td class="num"><strong class="val-pos">${UI.fmtMoney(c.al_dif.icms)}</strong></td></tr>
          <tr><td>Economia vs atual</td><td class="num val-pos">${UI.fmtMoney(c.al_dif.economia)}</td></tr>
          <tr><td>Redução de ICMS</td><td class="num val-pos">${UI.fmtMoney(c.al_dif.reducao_icms)}</td></tr>
        </tbody></table>
      </div>`;
  }

  function drawPdfTab(cliOpts) {
    const role = AUTH.role();
    // CLIENT: cliente fixo (não escolhe). SAYGO/ADM: select obrigatório.
    let cliField = '';
    if (role === 'CLIENT') {
      const myCli = clientesCache[0];
      cliField = myCli
        ? `<input type="hidden" id="cr-pdf-cliente" value="${myCli.id}">
           <div class="full muted small">Cliente: <strong>${UI.escapeHtml(myCli.nome)}</strong></div>`
        : '<div class="err">Sem cliente vinculado.</div>';
    } else {
      cliField = `
        <div class="full">
          <label>Cliente *</label>
          <select id="cr-pdf-cliente" required>
            <option value="">— selecione —</option>${cliOpts}
          </select>
        </div>`;
    }
    document.getElementById('cr-wiz-content').innerHTML = `
      <div class="form-grid">
        <div class="full muted small">
          Faça o upload de um PDF de invoice. A IA configurada (Parâmetros → IA) vai ler o documento e preencher os campos automaticamente.
          Depois você revisa, calcula e envia.
        </div>
        ${cliField}
        <div class="full">
          <label>Arquivo PDF *</label>
          <input type="file" id="cr-pdf-file" accept="application/pdf">
        </div>
        <div class="full form-actions">
          <button class="btn primary" id="cr-pdf-go">Analisar com IA</button>
        </div>
        <div class="full" id="cr-pdf-out"></div>
      </div>`;
    document.getElementById('cr-pdf-go').onclick = async () => {
      const cliEl = document.getElementById('cr-pdf-cliente');
      const cliId = cliEl?.value;
      if (!cliId) return UI.toast('Selecione o cliente', 'err');
      const file = document.getElementById('cr-pdf-file').files[0];
      if (!file) return UI.toast('Selecione um PDF', 'err');
      const out = document.getElementById('cr-pdf-out');
      out.innerHTML = '<div class="muted">Lendo PDF e consultando IA...</div>';
      try {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch('/api/credit-requests/analyze-pdf', { method: 'POST', credentials: 'include', body: fd });
        if (!r.ok) {
          const errText = await r.text();
          throw new Error(errText || `HTTP ${r.status}`);
        }
        const j = await r.json();
        out.innerHTML = `
          <div class="muted small" style="margin-bottom:.5rem">✓ Campos extraídos pela IA. Revise e clique em "Calcular".</div>
          <pre style="background:var(--s2);padding:.6rem;border-radius:6px;font-size:11px;max-height:160px;overflow:auto">${UI.escapeHtml(JSON.stringify(j.fields, null, 2))}</pre>
          <div class="form-actions" style="margin-top:.6rem">
            <button class="btn primary" id="cr-pdf-use">Usar esses dados no formulário</button>
          </div>`;
        document.getElementById('cr-pdf-use').onclick = () => {
          // volta pro tab manual com prefill (já com clienteId pré-selecionado)
          document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('primary', x.dataset.tab==='manual'));
          drawManualTab(cliOpts, { ...j.fields, _clienteId: cliId });
        };
      } catch (e) {
        out.innerHTML = `<div class="err">Erro: ${UI.escapeHtml(e.message)}</div>`;
      }
    };
  }

  // ---------- Detail ----------
  function openDetail(r) {
    const me = AUTH.user();
    const role = AUTH.role();
    const office = me?.officeName || me?.parceiroNome;
    // Solicitante = quem criou (CLIENT do cliente, ou SAYGO/ADM)
    const isOwner = r.requestedById === me?.id;
    // Resolvedor = PARTNER ESCRITORIO do escritório alvo (e SAYGO/ADM podem em fallback)
    const isResolver = role === 'PARTNER' && r.partnerOfficeName === office;
    const isStaff    = role === 'ADM' || role === 'SAYGO';
    const inp = r.inputs || {};
    const cen = r.result?.cenarios || {};

    UI.openModal(`Solicitação — ${r.cliente?.nome || ''}`, `
      <div class="muted small" style="margin-bottom:.6rem">
        ${UI.escapeHtml(r.cliente?.nome || '')} · ${UI.escapeHtml(r.partnerOfficeName)} · ${statusPill(r.status)} · ${UI.fmtDateTime(r.createdAt)}
        <br>Solicitante: ${UI.escapeHtml(r.requestedBy?.name || '—')}
        ${r.resolvedBy ? `· Resolvido por: ${UI.escapeHtml(r.resolvedBy?.name)} em ${UI.fmtDateTime(r.resolvedAt)}` : ''}
      </div>
      <div class="panel">
        <h3>Dados da invoice</h3>
        <table class="table"><tbody>
          <tr><td>NCM</td><td>${UI.escapeHtml(inp.ncm||'')}</td></tr>
          <tr><td>UF</td><td>${UI.escapeHtml(inp.uf||'')}</td></tr>
          <tr><td>FOB (USD)</td><td>${inp.vmle_usd ?? ''}</td></tr>
          <tr><td>Frete + Seguro (USD)</td><td>${(Number(inp.frete_usd||0) + Number(inp.seguro_usd||0)).toFixed(2)}</td></tr>
          <tr><td>Câmbio</td><td>${inp.taxa_cambio ?? ''}</td></tr>
          <tr><td>II / IPI / PIS / Cofins / ICMS</td>
            <td>${inp.ii_aliq||0}% / ${inp.ipi_aliq||0}% / ${inp.pis_aliq||0}% / ${inp.cofins_aliq||0}% / ${inp.icms_aliq_estado||0}%</td>
          </tr>
        </tbody></table>
        ${r.inputPdfName ? `<div class="muted small" style="margin-top:.4rem">📎 PDF original: <a href="/api/credit-requests/${r.id}/pdf" target="_blank">${UI.escapeHtml(r.inputPdfName)}</a></div>` : ''}
      </div>
      <div class="panel">
        <h3>Resultado</h3>
        <table class="table"><tbody>
          <tr><td>Modalidade</td><td>${r.modalidade === 'AL_NF' ? 'Alagoas NF (4%)' : 'Alagoas Dif (1.2%)'}</td></tr>
          <tr><td>Subtotal federal</td><td class="num">${UI.fmtMoney(r.result?.breakdown?.subtotal||0)}</td></tr>
          <tr><td>Custo atual</td><td class="num">${UI.fmtMoney(cen.atual?.custo_total||0)}</td></tr>
          <tr><td>Custo Alagoas (NF)</td><td class="num">${UI.fmtMoney(cen.al_nf?.custo_total||0)}</td></tr>
          <tr><td><strong>Créditos a comprar</strong></td><td class="num"><strong class="val-pos">${UI.fmtMoney(r.creditosACompar||0)}</strong></td></tr>
          <tr><td>Economia</td><td class="num val-pos">${UI.fmtMoney((r.modalidade==='AL_DIF'?cen.al_dif?.economia:cen.al_nf?.economia)||0)}</td></tr>
        </tbody></table>
      </div>
      ${r.message ? `<div class="panel"><h3>Mensagem do solicitante</h3><p>${UI.escapeHtml(r.message)}</p></div>` : ''}
      ${r.resolutionNote ? `<div class="panel"><h3>Resposta do interveniente</h3><p>${UI.escapeHtml(r.resolutionNote)}</p>
        ${r.resolutionAttachmentName ? `<div class="muted small" style="margin-top:.4rem">📎 Evidência: <a href="/api/credit-requests/${r.id}/evidence" target="_blank">${UI.escapeHtml(r.resolutionAttachmentName)}</a></div>` : ''}
      </div>` : ''}

      <div id="cr-actions"></div>
    `);

    // Render dos botões/forms
    const actDiv = document.getElementById('cr-actions');
    let html = '';
    if (isOwner && r.status === 'DRAFT')              html += `<button class="btn primary" data-act="send">Enviar para o interveniente</button> `;
    if (isOwner && (r.status === 'DRAFT' || r.status === 'SENT')) html += `<button class="btn danger" data-act="cancel">Cancelar</button> `;
    if ((isResolver || isStaff) && r.status === 'SENT')   html += `<button class="btn" data-act="start">Marcar em andamento</button> `;
    if ((isResolver || isStaff) && (r.status === 'SENT' || r.status === 'IN_PROGRESS')) html += `<button class="btn primary" data-act="resolve">Concluir solicitação</button> `;
    actDiv.innerHTML = html ? `<div class="form-actions">${html}</div>` : '';

    document.getElementById('modal-body').onclick = async e => {
      const act = e.target.getAttribute('data-act');
      if (!act) return;
      try {
        if (act === 'send')    { await API.post(`/api/credit-requests/${r.id}/send`); UI.toast('Enviada'); UI.closeModal(); render(); }
        if (act === 'cancel')  { await API.post(`/api/credit-requests/${r.id}/cancel`); UI.toast('Cancelada'); UI.closeModal(); render(); }
        if (act === 'start')   { await API.post(`/api/credit-requests/${r.id}/start`); UI.toast('Em andamento'); UI.closeModal(); render(); }
        if (act === 'resolve') { openResolveForm(r); }
      } catch (er) { UI.toast(er.message, 'err'); }
    };
  }

  // Form para concluir solicitação — anexo opcional
  function openResolveForm(r) {
    const div = document.getElementById('cr-actions');
    div.innerHTML = `
      <div class="panel" style="margin-top:.5rem">
        <h3>Concluir solicitação</h3>
        <form id="cr-resolve" class="form-grid">
          <div class="full"><label>Observação (opcional)</label>
            <textarea name="note" rows="3" placeholder="Detalhes da execução..."></textarea>
          </div>
          <div class="full"><label>Evidência (opcional — PDF, imagem etc.)</label>
            <input type="file" name="file">
            <small class="muted">Pode concluir sem anexo. Sem evidência, fica marcado "Concluído sem documentos".</small>
          </div>
          <div class="full form-actions">
            <button type="button" class="btn" id="cr-resolve-cancel">Voltar</button>
            <button type="submit" class="btn primary">Concluir</button>
          </div>
        </form>
      </div>`;
    document.getElementById('cr-resolve-cancel').onclick = () => openDetail(r);
    document.getElementById('cr-resolve').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        const resp = await fetch(`/api/credit-requests/${r.id}/resolve`, {
          method: 'POST', credentials: 'include', body: fd,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        UI.toast('Solicitação concluída'); UI.closeModal(); render();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  return { render };
})();
