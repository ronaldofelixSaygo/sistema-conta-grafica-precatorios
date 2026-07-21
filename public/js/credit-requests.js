// =====================================================================
// Solicitação de Créditos — multi-NCM (manual + PDF/IA)
// =====================================================================
window['VIEW_credit-requests'] = (() => {
  let clientesCache = [];
  let cabecalho = {};
  let grupos = [];   // [{ ncm, valor_usd, acrescimo_usd, frete_usd, outros_usd, ii, pis, cofins, ipi, siscomex, afrmm, antidumping }]
  let lastCalc = null;

  // Sugestão de compra: arredonda SEMPRE para cima em múltiplo de R$ 1.000.
  const ceilTo1000 = x => Math.ceil((Number(x) || 0) / 1000) * 1000;
  // Formata em reais SEM centavos (valores "redondos" da sugestão/depósito).
  const fmtMoney0 = x => 'R$ ' + Math.round(Number(x) || 0).toLocaleString('pt-BR');
  // Data (ISO) considerada "bem anterior" se mais de N dias atrás.
  const OLD_DAYS = 30;
  const _isOldDate = iso => { if (!iso) return false; const d = new Date(iso); return !isNaN(d) && (Date.now() - d.getTime()) / 86400000 > OLD_DAYS; };
  const _brDate = iso => (iso ? iso.split('-').reverse().join('/') : '');

  // Similaridade de razão social (pagador do comprovante x cliente selecionado).
  const _normNome = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const _NOME_STOP = new Set(['LTDA', 'EIRELI', 'SA', 'ME', 'EPP', 'CIA', 'E', 'DE', 'DA', 'DO', 'DOS', 'DAS', 'S', 'A']);
  const _nomeToks = s => _normNome(s).split(' ').filter(t => t.length >= 2 && !_NOME_STOP.has(t));
  const _tokMatch = (x, y) => { if (x === y) return true; const a = x.length <= y.length ? x : y, b = x.length <= y.length ? y : x; return a.length >= 3 && b.startsWith(a); };
  function nomesBatem(a, b) {
    const A = _nomeToks(a), B = _nomeToks(b);
    if (!A.length || !B.length) return true; // sem dados suficientes → não alerta
    let inter = 0; for (const t of A) if (B.some(u => _tokMatch(t, u))) inter++;
    const cont = inter / Math.min(A.length, B.length);
    const jac = inter / (A.length + B.length - inter);
    return jac >= 0.5 || cont >= 0.6;
  }

  // Editor de múltiplos comprovantes: arquivo + valor + data, com "Ler com IA"
  // (pré-preenche valor/data; o cliente confirma). Valida a soma >= depósito e
  // exige confirmação se alguma data for muito antiga. onChange(valid) avisa fora.
  function makeReceiptsEditor(mountEl, opts = {}) {
    let deposito = Number(opts.deposito || 0);
    let clienteNome = opts.clienteNome || '';
    const requestId = opts.requestId || null;
    const onChange = opts.onChange || (() => {});
    // Linhas novas: { file, valor, data, pagador }. Linhas existentes: { id, filename, valor, data }.
    let rows = (opts.existing || []).map(e => ({ id: e.id, filename: e.filename, valor: e.valor, data: e.data || null }));
    let confirmed = false;

    const sum = () => rows.reduce((s, r) => s + (Number(r.valor) || 0), 0);
    const mismatch = r => !!(r.pagador && clienteNome && !nomesBatem(clienteNome, r.pagador));
    const anyWarn = () => rows.some(r => _isOldDate(r.data) || mismatch(r));
    const valid = () => rows.length > 0 && (deposito <= 0 || sum() >= deposito) && (!anyWarn() || confirmed);

    function refreshSummary() {
      const box = mountEl.querySelector('#re-sum');
      if (!box) return;
      const s = sum(), okSum = deposito <= 0 || s >= deposito;
      box.style.color = okSum ? 'var(--green)' : 'var(--red)';
      box.textContent = `Soma dos comprovantes: ${fmtMoney0(s)} / necessário ${fmtMoney0(deposito)} ${okSum ? '✓' : '— falta ' + fmtMoney0(deposito - s)}`;
    }
    function render() {
      mountEl.innerHTML = `
        <div class="full">
          <label>Comprovante(s) de depósito ${deposito > 0 ? '*' : ''}</label>
          <input type="file" id="re-add" accept="application/pdf,image/*" multiple>
          <small class="muted">Pode anexar mais de um. A IA tenta ler o valor e a data — confira antes de enviar.</small>
        </div>
        <div class="full" id="re-rows">${rows.map((r, i) => `
          <div style="border:1px solid var(--bd);border-radius:8px;padding:.5rem;margin-top:.4rem">
            <div style="display:flex;justify-content:space-between;gap:.5rem;align-items:center">
              <strong style="font-size:12px;word-break:break-all">📎 ${UI.escapeHtml(r.file ? r.file.name : (r.filename || 'comprovante'))}</strong>
              <button type="button" class="btn small danger" data-rm="${i}">remover</button>
            </div>
            <div class="form-grid" style="margin-top:.4rem">
              <div><label>Valor (R$)</label><input type="number" step="0.01" min="0" data-f="valor" data-i="${i}" value="${r.valor != null ? r.valor : ''}"></div>
              <div><label>Data</label><input type="date" data-f="data" data-i="${i}" value="${r.data || ''}"></div>
              <div style="display:flex;align-items:flex-end;gap:.3rem">
                ${r.file ? `<button type="button" class="btn small" data-ai="${i}">✨ Ler com IA</button>` : ''}
                ${(r.id && requestId) ? `<a class="btn small" href="/api/credit-requests/${requestId}/receipts/${r.id}?download=1">Baixar</a>` : ''}
              </div>
            </div>
            ${_isOldDate(r.data) ? `<div style="color:var(--amber);font-size:12.5px;margin-top:.3rem;font-weight:600">⚠ Data ${_brDate(r.data)} é bem anterior a hoje. Confirme se anexou o comprovante correto.</div>` : ''}
            ${mismatch(r) ? `<div style="color:var(--amber);font-size:12.5px;margin-top:.3rem;font-weight:600">⚠ Pagador do comprovante ("${UI.escapeHtml(r.pagador)}") parece diferente do cliente selecionado. Confirme se é o comprovante certo.</div>` : ''}
          </div>`).join('')}</div>
        ${deposito > 0 ? '<div class="full" id="re-sum" style="margin-top:.5rem;padding:.55rem .7rem;border-radius:8px;background:var(--s2);font-weight:700;font-size:14px"></div>' : ''}
        ${anyWarn() ? `<label class="full" style="display:flex;gap:.5rem;align-items:center;margin-top:.5rem;color:var(--amber);font-weight:600"><input type="checkbox" id="re-confirm" ${confirmed ? 'checked' : ''}> Confirmo que os comprovantes anexados estão corretos (conferi data e pagador).</label>` : ''}`;
      refreshSummary();
      bind();
      onChange(valid());
    }
    function bind() {
      const add = mountEl.querySelector('#re-add');
      if (add) add.onchange = (e) => {
        for (const f of [...(e.target.files || [])]) { rows.push({ file: f, valor: null, data: null }); aiRead(rows.length - 1, false); }
        render();
      };
      mountEl.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { rows.splice(Number(b.dataset.rm), 1); render(); });
      mountEl.querySelectorAll('[data-f]').forEach(inp => {
        inp.oninput = () => {
          const i = Number(inp.dataset.i), f = inp.dataset.f;
          rows[i][f] = f === 'valor' ? (Number(inp.value) || 0) : inp.value;
          if (f === 'valor') refreshSummary();
          onChange(valid());
        };
        inp.onchange = () => render(); // blur → re-render (atualiza aviso de data)
      });
      mountEl.querySelectorAll('[data-ai]').forEach(b => b.onclick = () => aiRead(Number(b.dataset.ai), true));
      const cf = mountEl.querySelector('#re-confirm');
      if (cf) cf.onchange = () => { confirmed = cf.checked; onChange(valid()); };
    }
    async function aiRead(i, manual) {
      const r = rows[i]; if (!r) return;
      try {
        const fd = new FormData(); fd.append('file', r.file);
        const resp = await fetch('/api/credit-requests/analyze-receipt', { method: 'POST', credentials: 'include', body: fd });
        const j = await resp.json().catch(() => null);
        if (!resp.ok) throw new Error(j?.error || 'Falha na leitura');
        let got = false;
        if (j && j.valor != null) { r.valor = j.valor; got = true; }
        if (j && j.data) { r.data = j.data; got = true; }
        if (j && j.pagador) { r.pagador = j.pagador; }
        render();
        if (manual) UI.toast(got ? 'IA leu o comprovante — confira os valores' : 'IA não encontrou o valor — digite manualmente', got ? 'ok' : 'err');
      } catch (e) { if (manual) UI.toast(e.message, 'err'); }
    }
    render();
    return {
      isValid: valid,
      setDeposito: (v) => { deposito = Number(v || 0); render(); },
      setClienteNome: (v) => { clienteNome = v || ''; render(); },
      collect: () => {
        const novos = rows.filter(r => r.file && !r.id);
        const existentes = rows.filter(r => r.id);
        return {
          files: novos.map(r => r.file),
          valores: novos.map(r => Number(r.valor) || 0),
          datas: novos.map(r => r.data || ''),
          existing: existentes.map(r => ({ id: r.id, valor: Number(r.valor) || 0, data: r.data || '' })),
          sum: sum(), count: rows.length, valid: valid(),
        };
      },
    };
  }

  async function render() {
    const el = document.getElementById('view-credit-requests');
    el.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      const [list, clientes] = await Promise.all([
        API.get('/api/credit-requests', null, { ttl: 30000 }),
        API.get('/api/clientes', null, { ttl: 60000 }).catch(() => []),
      ]);
      clientesCache = clientes;
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
      const myCli = clientesCache[0];
      cliOpts = myCli ? `<option value="${myCli.id}" selected>${UI.escapeHtml(myCli.nome)}</option>` : '';
    } else {
      cliOpts = clientesCache.map(c =>
        `<option value="${c.id}">${UI.escapeHtml(c.nome)}${c.escritorio?` — ${UI.escapeHtml(c.escritorio)}`:''}</option>`
      ).join('');
    }

    // estado inicial
    cabecalho = { importadorNome:'', importadorCnpj:'', exportadorNome:'', exportadorPais:'',
                  uf:'AL', taxa_cambio:'', icms_aliq_estado: 18 };
    grupos = [emptyGrupo()];
    lastCalc = null;
    resetAnuentesState(); // limpa anuentes de aberturas anteriores

    UI.openModal('Nova solicitação de créditos', `
      <div style="display:flex;gap:.4rem;border-bottom:1px solid var(--bd);padding-bottom:.5rem;margin-bottom:1rem">
        <button class="btn primary" data-tab="manual">Preencher manualmente</button>
        <button class="btn"         data-tab="pdf">📄 Importar PDF (IA)</button>
      </div>
      <div id="cr-wiz-content"></div>`);
    const root = document.getElementById('modal-body');
    // Detecta se há algo preenchido na tela atual (arquivos, comprovantes,
    // inputs de texto/número). Selects (ex.: cliente) não contam.
    function wizardDirty() {
      const c = document.getElementById('cr-wiz-content');
      if (!c) return false;
      for (const inp of c.querySelectorAll('input[type=file]')) if (inp.files?.length) return true;
      if (c.querySelectorAll('#re-rows [data-rm]').length) return true;
      for (const inp of c.querySelectorAll('input:not([type=file]):not([type=checkbox]), textarea')) if ((inp.value || '').trim()) return true;
      return false;
    }
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      if (b.classList.contains('primary')) return; // já está nesta aba
      if (wizardDirty() && !confirm('Trocar de aba vai limpar o que você já preencheu nesta tela. Deseja continuar?')) return;
      root.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('primary', x === b));
      if (b.dataset.tab === 'pdf') drawPdfTab(cliOpts);
      else drawManualTab(cliOpts);
    });
    drawManualTab(cliOpts);
  }

  function emptyGrupo() {
    return {
      ncm: '', valor_usd: 0,
      acrescimo_usd: 0, frete_usd: 0, outros_usd: 0,
      ii: 0, pis: 0, cofins: 0, ipi: 0,
      siscomex: 0, afrmm: 0, antidumping: 0,
      // Alíquotas vindas do lookup NCM (pra recalcular se a base mudar)
      _ii_aliq: null, _pis_aliq: null, _cofins_aliq: null, _ipi_aliq: null,
    };
  }

  // Recalcula os valores em R$ de um grupo a partir das alíquotas salvas
  function recalcGrupoFromAliquotas(g) {
    const taxa = Number(cabecalho.taxa_cambio) || 0;
    if (taxa <= 0) return false;
    const baseBRL = (Number(g.valor_usd||0) + Number(g.acrescimo_usd||0)
                  + Number(g.frete_usd||0) + Number(g.outros_usd||0)) * taxa;
    let mudou = false;
    if (g._ii_aliq != null)     { g.ii     = +(baseBRL * g._ii_aliq / 100).toFixed(2);     mudou = true; }
    if (g._pis_aliq != null)    { g.pis    = +(baseBRL * g._pis_aliq / 100).toFixed(2);    mudou = true; }
    if (g._cofins_aliq != null) { g.cofins = +(baseBRL * g._cofins_aliq / 100).toFixed(2); mudou = true; }
    if (g._ipi_aliq != null)    {
      const baseIpi = baseBRL + (g.ii || 0);
      g.ipi = +(baseIpi * g._ipi_aliq / 100).toFixed(2);
      mudou = true;
    }
    return mudou;
  }

  function recalcAllGrupos() {
    let mudou = false;
    for (const g of grupos) {
      if (recalcGrupoFromAliquotas(g)) mudou = true;
    }
    if (mudou) updateAllRowsComputedDom();
  }

  // Atualiza no DOM os campos calculados (II/PIS/COFINS/IPI) de uma linha
  // SEM redesenhar a tabela inteira — preserva o foco do input que o usuário
  // está digitando.
  function updateRowComputedDom(idx, g) {
    const row = document.querySelector(`#cr-grupos [data-grow="${idx}"]`);
    if (!row) return;
    ['ii','pis','cofins','ipi'].forEach(f => {
      const inp = row.querySelector(`input[data-field="${f}"]`);
      if (inp && document.activeElement !== inp) {
        const v = g[f] ?? 0;
        inp.value = v === 0 ? '' : Number(v).toFixed(2);
      }
    });
  }
  function updateAllRowsComputedDom() {
    grupos.forEach((g, idx) => updateRowComputedDom(idx, g));
  }

  // Converte texto digitado pelo usuário em número (aceita vírgula ou ponto)
  function parseDec(v) {
    if (v == null || v === '') return 0;
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  // Sanitiza o input enquanto o usuário digita: mantém só dígitos + 1 separador
  // + até N decimais (default 2). Use data-decimals="4" pro input aceitar mais
  // (ex.: Taxa câmbio em R$/USD precisa de 4 casas).
  function sanitizeDecimalInput(el) {
    const start = el.selectionStart;
    const maxDec = Number(el.dataset.decimals) || 2;
    let v = el.value;
    // Mantém só dígitos, ponto e vírgula
    v = v.replace(/[^\d.,]/g, '');
    // Normaliza vírgula → ponto, mas só permite 1
    const partes = v.split(/[.,]/);
    if (partes.length > 2) v = partes[0] + '.' + partes.slice(1).join('');
    else if (partes.length === 2) v = partes[0] + '.' + partes[1].slice(0, maxDec);
    if (el.value !== v) {
      el.value = v;
      try { el.setSelectionRange(start, start); } catch {}
    }
  }

  // Aba "Preencher Manualmente" — fluxo simples de compra de crédito:
  // cliente + valor de crédito desejado -> depósito (% do cliente).
  // Pode salvar rascunho; para enviar ao interveniente exige comprovante e que
  // o valor depositado seja >= ao depósito necessário.
  function drawManualTab(cliOpts) {
    const role = AUTH.role();
    let cliField, fixedCliId = null;
    if (role === 'CLIENT') {
      const myCli = clientesCache[0];
      fixedCliId = myCli?.id ?? null;
      cliField = myCli
        ? `<input type="hidden" id="cm-cliente" value="${myCli.id}">
           <div class="full muted small">Cliente: <strong>${UI.escapeHtml(myCli.nome)}</strong></div>`
        : '<div class="err">Sem cliente vinculado.</div>';
    } else {
      cliField = `<div class="full"><label>Cliente *</label>
        <select id="cm-cliente" required><option value="">— selecione —</option>${cliOpts}</select></div>`;
    }

    document.getElementById('cr-wiz-content').innerHTML = `
      <div class="form-grid">
        ${cliField}
        <div class="full"><label>Valor de créditos desejado (R$) *</label>
          <input type="number" min="0" step="1" id="cm-valor" placeholder="0"></div>
        <div class="full" id="cm-dep-box" style="padding:.6rem;background:var(--s2);border-radius:8px">
          <div class="muted small">Depósito necessário (<span id="cm-pct">30</span>%)</div>
          <div style="font-size:1.3rem;font-weight:700" id="cm-dep">R$ 0</div>
        </div>
        <div class="full" id="cm-receipts"></div>
        <div class="full"><label>Mensagem (opcional)</label><textarea id="cm-msg" rows="2"></textarea></div>
        <div class="full" id="cm-err" style="display:none"></div>
        <div class="full form-actions">
          <button type="button" class="btn" id="cm-save">Salvar rascunho</button>
          <button type="button" class="btn primary" id="cm-send" disabled>Enviar para o interveniente</button>
        </div>
      </div>`;

    const clienteById = () => {
      const id = Number(document.getElementById('cm-cliente')?.value || fixedCliId || 0);
      return clientesCache.find(c => c.id === id) || null;
    };
    const getPct = () => Number(clienteById()?.percentualDeposito ?? 30);
    const getClienteNome = () => clienteById()?.nome || '';
    const deposito = () => Math.round((Number(document.getElementById('cm-valor').value) || 0) * getPct() / 100);
    const editor = makeReceiptsEditor(document.getElementById('cm-receipts'), {
      deposito: deposito(),
      clienteNome: getClienteNome(),
      onChange: (ok) => { const b = document.getElementById('cm-send'); if (b) b.disabled = !ok; },
    });
    const refreshDep = () => {
      document.getElementById('cm-pct').textContent = String(getPct());
      document.getElementById('cm-dep').textContent = fmtMoney0(deposito());
      editor.setDeposito(deposito());
    };
    document.getElementById('cm-valor').addEventListener('input', refreshDep);
    document.getElementById('cm-cliente')?.addEventListener('change', () => { refreshDep(); editor.setClienteNome(getClienteNome()); });
    refreshDep();

    const showErr = (msg) => {
      const e = document.getElementById('cm-err'); if (!e) return;
      e.style.display = msg ? '' : 'none';
      e.innerHTML = msg ? `<div style="padding:.6rem .8rem;border-radius:8px;background:rgba(220,50,50,.12);border:1px solid var(--red);color:var(--red);font-weight:600;font-size:14px">${UI.escapeHtml(msg)}</div>` : '';
    };

    async function submit(send) {
      const clienteId = document.getElementById('cm-cliente')?.value || fixedCliId;
      const valor = Number(document.getElementById('cm-valor').value) || 0;
      showErr('');
      if (!clienteId) return showErr('Selecione o cliente.');
      if (!(valor > 0)) return showErr('Informe o valor de créditos desejado.');
      const rc = editor.collect();
      if (send) {
        if (!rc.count) return showErr('Anexe pelo menos um comprovante de depósito para enviar.');
        if (!rc.valid) return showErr(`A soma dos comprovantes (${fmtMoney0(rc.sum)}) deve ser igual ou maior que o depósito necessário (${fmtMoney0(deposito())}). Havendo data antiga, marque a confirmação.`);
      }
      const fd = new FormData();
      fd.append('clienteId', clienteId);
      fd.append('manual', 'true');
      fd.append('creditosManuais', String(valor));
      fd.append('message', document.getElementById('cm-msg').value || '');
      if (send) fd.append('autoSend', 'true');
      rc.files.forEach(f => fd.append('comprovantes', f));
      fd.append('valores', JSON.stringify(rc.valores));
      fd.append('datas', JSON.stringify(rc.datas));
      const btn = document.getElementById(send ? 'cm-send' : 'cm-save');
      try {
        if (btn) btn.disabled = true;
        const resp = await fetch('/api/credit-requests', { method: 'POST', credentials: 'include', body: fd });
        if (!resp.ok) { const j = await resp.json().catch(() => null); throw new Error(j?.error || j?.message || `HTTP ${resp.status}`); }
        UI.toast(send ? 'Solicitação enviada' : 'Rascunho salvo'); UI.closeModal(); render();
      } catch (e) { showErr(e.message); if (btn) btn.disabled = false; }
    }
    document.getElementById('cm-save').onclick = () => submit(false);
    document.getElementById('cm-send').onclick = () => submit(true);
  }

  // Formulário completo por NCM (invoice). Usado pela aba "Importar PDF (IA)"
  // depois da extração, para revisar impostos e enviar.
  function drawInvoiceForm(cliOpts) {
    const me = AUTH.user();
    const preselectedCliId = cabecalho._clienteId ? String(cabecalho._clienteId) : '';
    const cliOptsPicked = preselectedCliId
      ? cliOpts.replace(`value="${preselectedCliId}"`, `value="${preselectedCliId}" selected`)
      : cliOpts;
    document.getElementById('cr-wiz-content').innerHTML = `
      <form id="cr-form" autocomplete="off">
        <div class="form-grid">
          <div class="full"><label>Cliente *</label>
            <select name="clienteId" required><option value="">—</option>${cliOptsPicked}</select>
          </div>

          <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem;margin-top:.4rem">
            <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Cabeçalho</strong>
          </div>
          <div><label>Importador (Nome)</label><input name="importadorNome" value="${UI.escapeHtml(cabecalho.importadorNome||'')}"></div>
          <div><label>Importador (CNPJ)</label><input name="importadorCnpj" value="${UI.escapeHtml(cabecalho.importadorCnpj||'')}"></div>
          <div><label>Exportador (Nome)</label><input name="exportadorNome" value="${UI.escapeHtml(cabecalho.exportadorNome||'')}"></div>
          <div><label>Exportador (País)</label><input name="exportadorPais" value="${UI.escapeHtml(cabecalho.exportadorPais||'')}"></div>
          <div><label>UF *</label><input name="uf" value="${UI.escapeHtml(cabecalho.uf||'AL')}" maxlength="2" required></div>
          <div><label>Taxa câmbio (R$/USD) *</label><input type="text" inputmode="decimal" class="num-decimal" data-decimals="4" name="taxa_cambio" value="${cabecalho.taxa_cambio || ''}" required></div>
          <div><label>ICMS estado (%) *</label><input type="text" inputmode="decimal" class="num-decimal" name="icms_aliq_estado" value="${cabecalho.icms_aliq_estado ?? 18}" required></div>
        </div>

        <div style="border-top:1px solid var(--bd);padding-top:.6rem;margin-top:.8rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
          <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Grupos por NCM</strong>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn small" id="cr-recalc-ncm" title="Re-consultar alíquotas atualizadas do dataset">🔄 Atualizar alíquotas</button>
            <button type="button" class="btn small" id="cr-add-ncm">+ Adicionar NCM</button>
          </div>
        </div>
        <div id="cr-grupos" style="overflow-x:auto;margin-top:.4rem"></div>

        <div class="form-grid" style="margin-top:.8rem">
          <div class="full" style="border-top:1px solid var(--bd);padding-top:.5rem">
            <label>Modalidade *</label>
            <select name="modalidade">
              <option value="AL_NF" selected>Alagoas NF (4%)</option>
              <option value="AL_DIF">Alagoas Diferencial (1.2%)</option>
            </select>
          </div>
          <div class="full"><label>Mensagem (opcional)</label><textarea name="message" rows="2"></textarea></div>

          <div class="full form-actions">
            <button type="button" class="btn" id="cr-calc">Calcular</button>
            <button type="submit" class="btn primary">Enviar para o interveniente</button>
          </div>
        </div>
        <div id="cr-result"></div>
      </form>`;

    drawGruposTable();
    document.getElementById('cr-add-ncm').onclick = () => { grupos.push(emptyGrupo()); drawGruposTable(); };
    document.getElementById('cr-recalc-ncm').onclick = recalcAllFromBackend;

    // captura mudanças no cabeçalho e na tabela
    const form = document.getElementById('cr-form');
    form.addEventListener('input', e => {
      const t = e.target;
      // Sanitiza inputs decimais (Valor USD, frete, etc) — mantém foco e cursor
      if (t.classList?.contains('num-decimal')) sanitizeDecimalInput(t);

      // Cabeçalho
      if (t.name && cabecalho.hasOwnProperty(t.name)) {
        cabecalho[t.name] = t.classList?.contains('num-decimal') ? parseDec(t.value)
                          : (t.type === 'number' ? Number(t.value) : t.value);
        if (t.name === 'taxa_cambio') {
          readGruposFromTable();
          recalcAllGrupos();
        }
      }
      // Linha da tabela
      const row = t.closest('[data-grow]');
      if (row) {
        const idx = Number(row.dataset.grow);
        const g = grupos[idx];
        const f = t.dataset.field;
        if (g && f && ['valor_usd','acrescimo_usd','frete_usd','outros_usd'].includes(f)) {
          g[f] = parseDec(t.value);
          // Recalcula só os campos calculados desta linha — SEM redesenhar a tabela
          // (preserva foco e cursor no input que o usuário está digitando).
          recalcGrupoFromAliquotas(g);
          updateRowComputedDom(idx, g);
        }
      }
    });

    document.getElementById('cr-calc').onclick = async () => {
      readGruposFromTable();
      const payload = buildInputs();
      try {
        const r = await API.post('/api/credit-requests/simulate', { inputs: payload });
        lastCalc = r;
        drawResult(r);
      } catch (e) { UI.toast(e.message, 'err'); }
    };

    form.onsubmit = async ev => {
      ev.preventDefault();
      if (!form.clienteId.value) return UI.toast('Selecione o cliente', 'err');
      readGruposFromTable();
      // Passo de confirmação: exige o comprovante de depósito antes de enviar.
      showSendConfirm();
    };

    // Mostra o passo de upload do comprovante de depósito (obrigatório p/ enviar).
    function showSendConfirm() {
      const box = document.getElementById('cr-result');
      box.innerHTML = `
        <div class="panel" style="margin-top:.6rem;border:1px solid var(--accent,#e8821e)">
          <h3>Comprovante de depósito</h3>
          <p class="muted small" style="margin:.2rem 0 .6rem">
            Para avançar para o interveniente, anexe o comprovante do depósito do valor
            que deseja incluir como crédito na conta gráfica.
          </p>
          <div class="full">
            <label>Comprovante (PDF ou imagem) *</label>
            <input type="file" id="cr-comprovante" accept="application/pdf,image/*">
          </div>
          <div class="form-actions" style="margin-top:.6rem">
            <button type="button" class="btn" id="cr-send-cancel">Voltar</button>
            <button type="button" class="btn primary" id="cr-send-confirm">Confirmar e enviar</button>
          </div>
        </div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'end' });
      document.getElementById('cr-send-cancel').onclick = () => { box.innerHTML = ''; };
      document.getElementById('cr-send-confirm').onclick = doSend;
    }

    async function doSend() {
      const file = document.getElementById('cr-comprovante')?.files?.[0];
      if (!file) return UI.toast('Anexe o comprovante de depósito', 'err');
      const btn = document.getElementById('cr-send-confirm');
      readGruposFromTable();
      const fd = new FormData();
      fd.append('clienteId', form.clienteId.value);
      fd.append('modalidade', form.modalidade.value);
      fd.append('message', form.message.value || '');
      fd.append('inputs', JSON.stringify(buildInputs()));
      fd.append('autoSend', 'true');
      fd.append('comprovante', file);
      try {
        if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
        const resp = await fetch('/api/credit-requests', { method: 'POST', credentials: 'include', body: fd });
        if (!resp.ok) {
          const j = await resp.json().catch(() => null);
          throw new Error(j?.error || j?.message || `HTTP ${resp.status}`);
        }
        UI.toast('Solicitação enviada para o interveniente'); UI.closeModal(); render();
      } catch (e) {
        UI.toast(e.message, 'err');
        if (btn) { btn.disabled = false; btn.textContent = 'Confirmar e enviar'; }
      }
    }
  }

  function buildInputs() {
    return {
      ...cabecalho,
      grupos: grupos.map(g => ({ ...g })),
    };
  }

  function readGruposFromTable() {
    const rows = document.querySelectorAll('#cr-grupos [data-grow]');
    rows.forEach(row => {
      const idx = Number(row.dataset.grow);
      const g = grupos[idx];
      if (!g) return;
      row.querySelectorAll('input').forEach(inp => {
        const f = inp.dataset.field;
        if (!f) return;
        g[f] = inp.classList.contains('num-decimal') ? parseDec(inp.value) : inp.value;
      });
    });
  }

  function drawGruposTable() {
    const headers = [
      { f: 'ncm',          l: 'NCM',         w: 160, t: 'text' },
      { f: 'valor_usd',    l: 'Valor USD',   w: 110, t: 'number' },
      { f: 'acrescimo_usd',l: 'Acréscimo',   w: 90,  t: 'number' },
      { f: 'frete_usd',    l: 'Frete',       w: 90,  t: 'number' },
      { f: 'outros_usd',   l: 'Outros',      w: 90,  t: 'number' },
      { f: 'ii',           l: 'II R$',       w: 100, t: 'number' },
      { f: 'pis',          l: 'PIS R$',      w: 100, t: 'number' },
      { f: 'cofins',       l: 'COFINS R$',   w: 100, t: 'number' },
      { f: 'ipi',          l: 'IPI R$',      w: 100, t: 'number' },
      { f: 'siscomex',     l: 'Siscomex/AFRMM', w: 110, t: 'number' },
    ];
    const head = headers.map(h => `<th style="font-size:10px;padding:4px 6px;min-width:${h.w}px">${h.l}</th>`).join('') + '<th></th>';
    const rows = grupos.map((g, idx) => `
      <tr data-grow="${idx}">
        ${headers.map(h => {
          if (h.f === 'ncm') {
            return `<td style="padding:2px 4px;white-space:nowrap">
              <input type="text" data-field="ncm" value="${g.ncm ?? ''}" placeholder="ex: 8517.62.59" style="width:120px;display:inline-block">
              <button type="button" class="btn small" data-lookup-ncm="${idx}" title="Buscar tributos e anuentes">🔍</button>
            </td>`;
          }
          // Campos numéricos: type=text + inputmode=decimal (sem spinners do browser)
          // A sanitização é feita pelo handler de input (sanitizeDecimalInput).
          const v = g[h.f] ?? '';
          const valFmt = v === '' || v === 0 ? '' : Number(v).toFixed(2);
          return `<td style="padding:2px 4px"><input type="text" inputmode="decimal" class="num-decimal" data-field="${h.f}" value="${valFmt}" style="width:100%;text-align:right"></td>`;
        }).join('')}
        <td><button type="button" class="btn small danger" data-rm-ncm="${idx}">×</button></td>
      </tr>`).join('');
    const div = document.getElementById('cr-grupos');
    div.innerHTML = `
      <table class="table" style="font-size:12px"><thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody></table>
      <div id="cr-anuentes" style="margin-top:.6rem"></div>`;
    div.querySelectorAll('[data-rm-ncm]').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.rmNcm);
      readGruposFromTable();
      grupos.splice(i, 1);
      if (!grupos.length) grupos = [emptyGrupo()];
      drawGruposTable();
      drawAnuentes(); // limpa anuentes de NCMs removidos
    });
    div.querySelectorAll('[data-lookup-ncm]').forEach(b => b.onclick = () => lookupNcmRow(Number(b.dataset.lookupNcm)));
  }

  // Estado dos anuentes — só cache de lookup. A exibição filtra pelos NCMs
  // atualmente na tabela `grupos` pra não vazar histórico de NCMs removidos.
  let anuentesByNcm = {}; // { '85176259': [...] }
  function resetAnuentesState() { anuentesByNcm = {}; }

  // Re-consulta /api/ncm para todos os grupos preenchidos e recalcula tudo
  async function recalcAllFromBackend() {
    readGruposFromTable();
    const uf = (cabecalho.uf || 'AL').toUpperCase();
    const validGrupos = grupos.filter(g => (g.ncm || '').replace(/\D/g, '').length >= 2);
    if (!validGrupos.length) return UI.toast('Nenhum NCM preenchido', 'err');
    let atualizados = 0;
    // Limpa cache antigo de alíquotas pra forçar refresh
    for (const g of validGrupos) {
      const ncmRaw = String(g.ncm).replace(/\D/g, '');
      try {
        const r = await API.get(`/api/ncm/${ncmRaw}`, { uf });
        g._ii_aliq     = r.ii_aliq;
        g._pis_aliq    = r.pis_aliq;
        g._cofins_aliq = r.cofins_aliq;
        g._ipi_aliq    = r.ipi_aliq;
        if (r.icms_aliq != null) cabecalho.icms_aliq_estado = r.icms_aliq;
        anuentesByNcm[ncmRaw] = r.anuentes || [];
        atualizados++;
      } catch (e) {
        console.warn('Lookup falhou pra', ncmRaw, e);
      }
    }
    recalcAllGrupos();
    drawGruposTable();
    drawAnuentes();
    UI.toast(`✓ ${atualizados} NCM(s) recalculado(s) com alíquotas atuais`);
  }

  async function lookupNcmRow(idx) {
    readGruposFromTable();
    const g = grupos[idx];
    if (!g) return;
    const ncmRaw = (g.ncm || '').replace(/\D/g, '');
    if (ncmRaw.length < 2) return UI.toast('Informe o NCM', 'err');
    const uf = (cabecalho.uf || 'AL').toUpperCase();
    try {
      const r = await API.get(`/api/ncm/${ncmRaw}`, { uf });
      // Salva alíquotas no grupo — recalcula em R$ sempre que valor_usd ou taxa mudar
      g._ii_aliq     = r.ii_aliq;
      g._pis_aliq    = r.pis_aliq;
      g._cofins_aliq = r.cofins_aliq;
      g._ipi_aliq    = r.ipi_aliq;
      if (r.icms_aliq != null) {
        cabecalho.icms_aliq_estado = r.icms_aliq;
      }
      anuentesByNcm[ncmRaw] = r.anuentes || [];

      const taxa = Number(cabecalho.taxa_cambio) || 0;
      if (taxa <= 0) {
        UI.toast('⚠ Preencha a Taxa câmbio para calcular os impostos em R$', 'err');
        // Mesmo sem taxa, redesenha pra mostrar anuentes e atualizar ICMS
        drawGruposTable();
        drawAnuentes();
        return;
      }
      // Calcula valores em R$
      recalcGrupoFromAliquotas(g);
      drawGruposTable();
      drawAnuentes();

      const lvl = r.matchLevel === 8 ? 'NCM exato'
                : r.matchLevel ? `aproximado (${r.matchLevel} dígitos)`
                : 'não encontrado — usando defaults';
      UI.toast(`✓ ${lvl}${r.descricao ? ' — ' + r.descricao.slice(0, 40) : ''}`);
    } catch (e) {
      UI.toast('Falha no lookup: ' + e.message, 'err');
    }
  }

  function drawAnuentes() {
    const div = document.getElementById('cr-anuentes');
    if (!div) return;
    // Filtra: só mostra anuentes dos NCMs atualmente nos grupos da tabela.
    // Limpa também o cache pra liberar memória de NCMs que foram removidos.
    const ncmsAtivos = new Set(
      (grupos || [])
        .map(g => String(g?.ncm || '').replace(/\D/g, ''))
        .filter(n => n.length >= 2)
    );
    for (const k of Object.keys(anuentesByNcm)) {
      if (!ncmsAtivos.has(k)) delete anuentesByNcm[k];
    }
    const all = Object.entries(anuentesByNcm);
    if (!all.length) { div.innerHTML = ''; return; }
    const cards = all.map(([ncm, list]) => {
      if (!list.length) return `
        <div style="background:var(--s2);padding:.5rem .8rem;border-radius:6px;border-left:3px solid var(--green);margin-bottom:.4rem">
          <strong>NCM ${ncm}</strong> · <span class="muted small">sem anuente exigido</span>
        </div>`;
      return `
        <div style="background:var(--s2);padding:.5rem .8rem;border-radius:6px;border-left:3px solid var(--amber);margin-bottom:.4rem">
          <strong>NCM ${ncm}</strong> · <span class="muted small">anuentes obrigatórios:</span>
          <div style="margin-top:.3rem;display:flex;gap:6px;flex-wrap:wrap">
            ${list.map(a => `<span class="pill ${a.obrigatorio?'amber':''}" title="${UI.escapeHtml(a.descricao||'')}">${UI.escapeHtml(a.anuente)}${a.obrigatorio?'':' (condicional)'}</span>`).join('')}
          </div>
          ${list.map(a => a.descricao ? `<div class="muted small" style="margin-top:4px">• ${UI.escapeHtml(a.anuente)}: ${UI.escapeHtml(a.descricao)}</div>` : '').join('')}
        </div>`;
    }).join('');
    div.innerHTML = `
      <div class="muted small" style="margin-bottom:.3rem">⚠ Órgãos anuentes que controlam os NCMs informados:</div>
      ${cards}`;
  }

  function drawResult(r) {
    const out = document.getElementById('cr-result');
    if (!r) { out.innerHTML = ''; return; }
    if (!r.valid) {
      out.innerHTML = `<div class="err">${r.warnings.join('<br>')}</div>`;
      return;
    }
    // Mesmo formato da Solicitação aberta (modal de detalhe): 5 colunas
    // (NCM | Subtotal | ICMS atual | ICMS NF 4% | ICMS Pagar 1.2%) + Resumo
    // único baseado na Modalidade selecionada no form.
    const t = r.total || {};
    const ncmRows = (r.porNcm || []).map(g => {
      const b = g.breakdown || {}, c = g.cenarios || {};
      return `<tr>
        <td><strong>${UI.escapeHtml(g.ncm)}</strong></td>
        <td class="num">${UI.fmtMoney(b.subtotal)}</td>
        <td class="num val-neg">${UI.fmtMoney(c.atual?.icms || 0)}</td>
        <td class="num val-pos">${UI.fmtMoney(c.al_nf?.icms || 0)}</td>
        <td class="num val-pos">${UI.fmtMoney(c.al_dif?.icms || 0)}</td>
      </tr>`;
    }).join('');

    const modalidade = document.querySelector('select[name="modalidade"]')?.value || 'AL_NF';
    const modalidadeLabel = modalidade === 'AL_NF' ? 'Alagoas NF (4%)' : 'Alagoas Dif (1.2%)';

    out.innerHTML = `
      <div class="panel" style="margin-top:1rem">
        <h3>Resultado por NCM</h3>
        <table class="table" style="font-size:12px">
          <thead><tr><th>NCM</th><th>Subtotal</th><th>ICMS atual</th><th>ICMS NF 4%</th><th>ICMS Pagar 1.2%</th></tr></thead>
          <tbody>${ncmRows || '<tr><td colspan="5" class="muted">Sem dados</td></tr>'}</tbody>
        </table>
      </div>
      <div class="panel">
        <h3>Resumo</h3>
        <table class="table"><tbody>
          <tr><td>Modalidade</td><td>${modalidadeLabel}</td></tr>
          <tr><td>Subtotal federal</td><td class="num">${UI.fmtMoney(t.subtotal || 0)}</td></tr>
          <tr><td>Custo atual</td><td class="num">${UI.fmtMoney(t.icms_atual || 0)}</td></tr>
          <tr><td><strong>Crédito a comprar — 4%</strong></td><td class="num"><strong class="val-pos">${UI.fmtMoney(t.icms_al_nf || 0)}</strong></td></tr>
          <tr><td class="muted small">ICMS efetivo (diferimento 1,2%)</td><td class="num muted">${UI.fmtMoney(t.icms_al_dif || 0)}</td></tr>
          <tr><td>Economia vs cenário atual</td><td class="num val-pos">${UI.fmtMoney(((t.icms_atual || 0) - (t.icms_al_nf || 0)))}</td></tr>
          <tr><td><strong>Sugestão de compra (+10%, arredondada)</strong></td><td class="num"><strong class="val-pos">${fmtMoney0(ceilTo1000((t.icms_al_nf || 0) * 1.10))}</strong></td></tr>
        </tbody></table>
      </div>`;
  }

  function drawPdfTab(cliOpts) {
    const role = AUTH.role();
    let cliField = '';
    if (role === 'CLIENT') {
      const myCli = clientesCache[0];
      cliField = myCli
        ? `<input type="hidden" id="cr-pdf-cliente" value="${myCli.id}">
           <div class="full muted small">Cliente: <strong>${UI.escapeHtml(myCli.nome)}</strong></div>`
        : '<div class="err">Sem cliente vinculado.</div>';
    } else {
      cliField = `
        <div class="full"><label>Cliente *</label>
          <select id="cr-pdf-cliente" required>
            <option value="">— selecione —</option>${cliOpts}
          </select>
        </div>`;
    }
    document.getElementById('cr-wiz-content').innerHTML = `
      <div class="form-grid">
        <div class="full muted small">
          Faça o upload de um PDF de invoice. A IA configurada vai ler todos os itens e agrupar automaticamente por NCM.
          Depois você revisa, completa as alíquotas/impostos por NCM e envia.
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
        const f = j.fields || {};
        // Popula state
        cabecalho = {
          importadorNome: f.importadorNome || '',
          importadorCnpj: f.importadorCnpj || '',
          exportadorNome: f.exportadorNome || '',
          exportadorPais: f.exportadorPais || '',
          uf: f.uf || 'AL',
          taxa_cambio: f.taxa_cambio || '',
          icms_aliq_estado: 18,
          _clienteId: cliId,
        };
        const ncmGroups = Array.isArray(f.ncmGroups) ? f.ncmGroups : [];
        if (ncmGroups.length) {
          // distribuir frete/seguro proporcionalmente ao valor de cada NCM
          const totalUSD = ncmGroups.reduce((s,g) => s + (g.extension_usd_total||0), 0) || 1;
          grupos = ncmGroups.map(g => {
            const share = (g.extension_usd_total || 0) / totalUSD;
            return {
              ncm: g.ncm,
              valor_usd: Number((g.extension_usd_total||0).toFixed(2)),
              acrescimo_usd: 0,
              frete_usd: Number(((f.frete_usd_total||0) * share).toFixed(2)),
              outros_usd: Number(((f.seguro_usd_total||0) * share).toFixed(2)),
              ii: 0, pis: 0, cofins: 0, ipi: 0,
              siscomex: 0, afrmm: 0, antidumping: 0,
            };
          });
        } else {
          grupos = [emptyGrupo()];
        }
        out.innerHTML = `
          <div class="muted small" style="margin-bottom:.5rem">✓ ${ncmGroups.length} NCM(s) extraído(s) pela IA. Clique em "Usar esses dados" para revisar e completar os impostos.</div>
          <pre style="background:var(--s2);padding:.6rem;border-radius:6px;font-size:11px;max-height:200px;overflow:auto">${UI.escapeHtml(JSON.stringify({ cabecalho, grupos }, null, 2))}</pre>
          <div class="form-actions" style="margin-top:.6rem">
            <button class="btn primary" id="cr-pdf-use">Usar esses dados no formulário</button>
          </div>`;
        document.getElementById('cr-pdf-use').onclick = () => {
          drawInvoiceForm(cliOpts);
        };
      } catch (e) {
        out.innerHTML = `<div class="err">Erro: ${UI.escapeHtml(e.message)}</div>`;
      }
    };
  }

  // ---------- Detail ----------
  async function openDetail(r) {
    // A listagem omite os campos pesados (result, inputs) por performance.
    // Se o objeto recebido não trouxer result.total, busca o registro completo.
    if (!r?.result?.total) {
      try {
        const full = await API.get(`/api/credit-requests/${r.id}`);
        if (full) r = { ...r, ...full };
      } catch (e) {
        console.warn('Falha ao carregar detalhes completos:', e.message);
      }
    }
    const me = AUTH.user();
    const role = AUTH.role();
    const office = me?.officeName || me?.parceiroNome;
    const isOwner = r.requestedById === me?.id;
    const isResolver = role === 'PARTNER' && r.partnerOfficeName === office;
    const isStaff    = role === 'ADM' || role === 'SAYGO';
    const result = r.result || {};
    const total = result.total || {};
    const isManual = !!result.manual;

    const ncmRows = (result.porNcm || []).map(g => {
      const b = g.breakdown||{}, c = g.cenarios||{};
      return `<tr>
        <td><strong>${UI.escapeHtml(g.ncm)}</strong></td>
        <td class="num">${UI.fmtMoney(b.subtotal)}</td>
        <td class="num val-neg">${UI.fmtMoney(c.atual?.icms||0)}</td>
        <td class="num val-pos">${UI.fmtMoney(c.al_nf?.icms||0)}</td>
        <td class="num val-pos">${UI.fmtMoney(c.al_dif?.icms||0)}</td>
      </tr>`;
    }).join('');

    UI.openModal(`Solicitação — ${r.cliente?.nome || ''}`, `
      <div class="muted small" style="margin-bottom:.6rem">
        ${UI.escapeHtml(r.cliente?.nome || '')} · ${UI.escapeHtml(r.partnerOfficeName)} · ${statusPill(r.status)} · ${UI.fmtDateTime(r.createdAt)}
        <br>Solicitante: ${UI.escapeHtml(r.requestedBy?.name || '—')}
        ${r.resolvedBy ? `· Resolvido por: ${UI.escapeHtml(r.resolvedBy?.name)} em ${UI.fmtDateTime(r.resolvedAt)}` : ''}
      </div>
      ${isManual ? '' : `<div class="panel">
        <h3>Resultado por NCM</h3>
        <table class="table" style="font-size:12px">
          <thead><tr><th>NCM</th><th>Subtotal</th><th>ICMS atual</th><th>ICMS NF 4%</th><th>ICMS Pagar 1.2%</th></tr></thead>
          <tbody>${ncmRows || '<tr><td colspan="5" class="muted">Sem dados</td></tr>'}</tbody>
        </table>
      </div>`}
      <div class="panel">
        <h3>Resumo</h3>
        <table class="table"><tbody>
          ${isManual ? `
          <tr><td><strong>Créditos desejados</strong></td><td class="num"><strong class="val-pos">${fmtMoney0(r.creditosACompar||0)}</strong></td></tr>
          <tr><td><strong>Depósito necessário (${result.percentualDeposito ?? 30}%)</strong></td><td class="num"><strong class="val-pos">${fmtMoney0(result.depositoNecessario ?? ((r.creditosACompar||0)*(result.percentualDeposito ?? 30)/100))}</strong></td></tr>
          ${result.valorDepositado != null ? `<tr><td>Valor depositado (comprovante)</td><td class="num">${fmtMoney0(result.valorDepositado)}</td></tr>` : ''}
          ` : `
          <tr><td>Modalidade</td><td>${r.modalidade === 'AL_NF' ? 'Alagoas NF (4%)' : 'Alagoas Dif (1.2%)'}</td></tr>
          <tr><td>Subtotal federal</td><td class="num">${UI.fmtMoney(total.subtotal||0)}</td></tr>
          <tr><td>Custo atual</td><td class="num">${UI.fmtMoney(total.icms_atual||0)}</td></tr>
          <tr><td><strong>Crédito a comprar — 4%</strong></td><td class="num"><strong class="val-pos">${UI.fmtMoney(total.icms_al_nf||0)}</strong></td></tr>
          <tr><td class="muted small">ICMS efetivo (diferimento 1,2%)</td><td class="num muted">${UI.fmtMoney(total.icms_al_dif||0)}</td></tr>
          <tr><td>Economia vs cenário atual</td><td class="num val-pos">${UI.fmtMoney(((total.icms_atual||0) - (total.icms_al_nf||0)))}</td></tr>
          <tr><td><strong>Sugestão de compra (+10%, arredondada)</strong></td><td class="num"><strong class="val-pos">${fmtMoney0(ceilTo1000((total.icms_al_nf||0) * 1.10))}</strong></td></tr>
          `}
        </tbody></table>
        ${r.inputPdfName ? `<div class="muted small" style="margin-top:.4rem">📎 PDF original: <a href="/api/credit-requests/${r.id}/pdf" target="_blank">${UI.escapeHtml(r.inputPdfName)}</a></div>` : ''}
        ${(Array.isArray(r.receipts) && r.receipts.length) ? `<div class="small" style="margin-top:.5rem;padding:.5rem;background:var(--s2);border-radius:6px">
          <strong>🧾 Comprovantes de depósito (${r.receipts.length})</strong>
          <table class="table" style="margin-top:.3rem;font-size:12px"><tbody>
            ${r.receipts.map(rc => `<tr>
              <td style="word-break:break-all">${UI.escapeHtml(rc.filename)}</td>
              <td class="num">${fmtMoney0(rc.valor || 0)}</td>
              <td>${rc.data ? new Date(rc.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'}</td>
              <td><a class="btn small" href="/api/credit-requests/${r.id}/receipts/${rc.id}?download=1">⬇ Baixar</a></td>
            </tr>`).join('')}
          </tbody></table>
          <div class="muted small">Total: <strong>${fmtMoney0(r.receipts.reduce((s, x) => s + (Number(x.valor) || 0), 0))}</strong></div>
        </div>` : (r.paymentReceiptName ? `<div class="small" style="margin-top:.4rem;padding:.5rem;background:var(--s2);border-radius:6px;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
          <span>🧾 <strong>Comprovante de depósito:</strong> ${UI.escapeHtml(r.paymentReceiptName)}</span>
          <span style="flex:1"></span>
          <button class="btn small" data-act="view-receipt" data-name="${UI.escapeHtml(r.paymentReceiptName)}">👁 Visualizar</button>
          <a class="btn small primary" href="/api/credit-requests/${r.id}/payment-receipt?download=1" download="${UI.escapeHtml(r.paymentReceiptName)}">⬇ Baixar</a>
        </div>` : '')}
      </div>
      ${r.message ? `<div class="panel"><h3>Mensagem do solicitante</h3><p>${UI.escapeHtml(r.message)}</p></div>` : ''}
      ${(r.resolutionNote || r.resolutionAttachmentName) ? `<div class="panel"><h3>Resposta do interveniente</h3>
        ${r.resolutionNote ? `<p>${UI.escapeHtml(r.resolutionNote)}</p>` : ''}
        ${r.resolutionAttachmentName ? `<div style="margin-top:.6rem;padding:.6rem;background:var(--s2);border-radius:6px;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
          <span>📎 <strong>${UI.escapeHtml(r.resolutionAttachmentName)}</strong></span>
          <span style="flex:1"></span>
          <button class="btn small" data-act="view-evidence" data-name="${UI.escapeHtml(r.resolutionAttachmentName)}">👁 Visualizar</button>
          <a class="btn small primary" href="/api/credit-requests/${r.id}/evidence?download=1" download="${UI.escapeHtml(r.resolutionAttachmentName)}">⬇ Baixar</a>
        </div>` : ''}
      </div>` : ''}
      <div id="cr-actions"></div>
    `);

    const actDiv = document.getElementById('cr-actions');
    let html = '';
    if (isOwner && r.status === 'DRAFT')              html += `<button class="btn primary" data-act="send">Enviar para o interveniente</button> `;
    if ((isOwner || isStaff) && r.status === 'DRAFT') html += `<button class="btn" data-act="edit">Editar</button> `;
    if (isOwner && (r.status === 'DRAFT' || r.status === 'SENT')) html += `<button class="btn danger" data-act="cancel">Cancelar</button> `;
    if ((isResolver || isStaff) && r.status === 'SENT')   html += `<button class="btn" data-act="start">Marcar em andamento</button> `;
    if ((isResolver || isStaff) && (r.status === 'SENT' || r.status === 'IN_PROGRESS')) html += `<button class="btn primary" data-act="resolve">Concluir solicitação</button> `;
    actDiv.innerHTML = html ? `<div class="form-actions">${html}</div>` : '';

    document.getElementById('modal-body').onclick = async e => {
      const btn = e.target.closest('[data-act]');
      const act = btn?.getAttribute('data-act');
      if (!act) return;
      try {
        if (act === 'send')    { openSendForm(r); }
        if (act === 'edit')    { openEditDraft(r); }
        if (act === 'cancel')  { await API.post(`/api/credit-requests/${r.id}/cancel`); UI.toast('Cancelada'); UI.closeModal(); render(); }
        if (act === 'start')   { await API.post(`/api/credit-requests/${r.id}/start`); UI.toast('Em andamento'); UI.closeModal(); render(); }
        if (act === 'resolve') { openResolveForm(r); }
        if (act === 'view-evidence') {
          VIEWER.open({
            url: `/api/credit-requests/${r.id}/evidence`,
            filename: btn.dataset.name || r.resolutionAttachmentName || 'evidencia',
          });
        }
        if (act === 'view-receipt') {
          VIEWER.open({
            url: `/api/credit-requests/${r.id}/payment-receipt`,
            filename: btn.dataset.name || r.paymentReceiptName || 'comprovante',
          });
        }
      } catch (er) { UI.toast(er.message, 'err'); }
    };
  }

  // Enviar um rascunho existente ao interveniente — exige o comprovante de depósito.
  function openSendForm(r) {
    const div = document.getElementById('cr-actions');
    const result = r.result || {};
    const isManual = !!result.manual;
    const jaExistentes = Array.isArray(r.receipts) ? r.receipts : [];
    const somaExistente = jaExistentes.reduce((s, x) => s + (Number(x.valor) || 0), 0);
    const necessario = isManual ? Number(result.depositoNecessario || 0) : 0;
    const restante = Math.max(0, necessario - somaExistente);

    div.innerHTML = `
      <div class="panel" style="margin-top:.5rem;border:1px solid var(--accent,#e8821e)">
        <h3>Enviar para o interveniente</h3>
        ${isManual ? `<div class="muted small" style="margin-bottom:.5rem">
          Depósito necessário: <strong>${fmtMoney0(necessario)}</strong>${somaExistente > 0 ? ` · já anexado: <strong>${fmtMoney0(somaExistente)}</strong> · falta: <strong>${fmtMoney0(restante)}</strong>` : ''}
        </div>` : ''}
        <div class="form-grid">
          <div class="full" id="cr-send-receipts"></div>
          <div class="full" id="cr-send-err" style="display:none"></div>
          <div class="full form-actions">
            <button type="button" class="btn" id="cr-send-back">Voltar</button>
            <button type="button" class="btn primary" id="cr-send-go" disabled>Enviar</button>
          </div>
        </div>
      </div>`;
    const editor = makeReceiptsEditor(document.getElementById('cr-send-receipts'), {
      deposito: restante,
      clienteNome: r.cliente?.nome || '',
      onChange: (ok) => { const b = document.getElementById('cr-send-go'); if (b) b.disabled = !ok; },
    });
    const showErr = (msg) => {
      const e = document.getElementById('cr-send-err'); if (!e) return;
      e.style.display = msg ? '' : 'none';
      e.innerHTML = msg ? `<div style="padding:.6rem .8rem;border-radius:8px;background:rgba(220,50,50,.12);border:1px solid var(--red);color:var(--red);font-weight:600;font-size:14px">${UI.escapeHtml(msg)}</div>` : '';
    };
    document.getElementById('cr-send-back').onclick = () => openDetail(r);
    document.getElementById('cr-send-go').onclick = async () => {
      showErr('');
      const rc = editor.collect();
      if (!rc.count) return showErr('Anexe pelo menos um comprovante de depósito.');
      if (!rc.valid) return showErr(`A soma dos comprovantes (${fmtMoney0(rc.sum)}) deve cobrir o restante (${fmtMoney0(restante)}). Havendo data antiga, marque a confirmação.`);
      const fd = new FormData();
      rc.files.forEach(f => fd.append('comprovantes', f));
      fd.append('valores', JSON.stringify(rc.valores));
      fd.append('datas', JSON.stringify(rc.datas));
      try {
        const resp = await fetch(`/api/credit-requests/${r.id}/send`, { method: 'POST', credentials: 'include', body: fd });
        if (!resp.ok) { const j = await resp.json().catch(() => null); throw new Error(j?.error || j?.message || `HTTP ${resp.status}`); }
        UI.toast('Enviada'); UI.closeModal(); render();
      } catch (e) { showErr(e.message); }
    };
  }

  // Editar um rascunho: valor desejado (manual), mensagem e comprovantes
  // (adicionar novos, editar valor/data ou remover os existentes).
  function openEditDraft(r) {
    const isManual = !!(r.result && r.result.manual);
    const creditos = Number(r.result?.creditos ?? r.creditosACompar ?? 0);
    const cli = clientesCache.find(c => c.id === r.clienteId);
    const pct = Number(r.result?.percentualDeposito ?? cli?.percentualDeposito ?? 30);
    UI.openModal(`Editar rascunho — ${r.cliente?.nome || ''}`, `
      <div class="form-grid">
        ${isManual ? `<div class="full"><label>Valor de créditos desejado (R$) *</label>
          <input type="number" min="0" step="1" id="ed-valor" value="${creditos}"></div>
        <div class="full" style="padding:.6rem;background:var(--s2);border-radius:8px">
          <div class="muted small">Depósito necessário (${pct}%)</div>
          <div style="font-size:1.3rem;font-weight:700" id="ed-dep">R$ 0</div>
        </div>` : ''}
        <div class="full" id="ed-receipts"></div>
        <div class="full"><label>Mensagem (opcional)</label><textarea id="ed-msg" rows="2">${UI.escapeHtml(r.message || '')}</textarea></div>
        <div class="full" id="ed-err" style="display:none"></div>
        <div class="full form-actions">
          <button type="button" class="btn" id="ed-cancel">Voltar</button>
          <button type="button" class="btn primary" id="ed-save">Salvar alterações</button>
        </div>
      </div>`);
    const deposito = () => Math.round((Number(document.getElementById('ed-valor')?.value ?? creditos) || 0) * pct / 100);
    const editor = makeReceiptsEditor(document.getElementById('ed-receipts'), {
      deposito: isManual ? deposito() : 0,
      clienteNome: r.cliente?.nome || '',
      requestId: r.id,
      existing: (r.receipts || []).map(x => ({ id: x.id, filename: x.filename, valor: x.valor, data: x.data ? String(x.data).slice(0, 10) : '' })),
      onChange: () => {},
    });
    const depEl = document.getElementById('ed-dep');
    if (depEl) depEl.textContent = fmtMoney0(deposito());
    document.getElementById('ed-valor')?.addEventListener('input', () => {
      if (depEl) depEl.textContent = fmtMoney0(deposito());
      editor.setDeposito(deposito());
    });
    const showErr = (msg) => {
      const e = document.getElementById('ed-err'); if (!e) return;
      e.style.display = msg ? '' : 'none';
      e.innerHTML = msg ? `<div style="padding:.6rem .8rem;border-radius:8px;background:rgba(220,50,50,.12);border:1px solid var(--red);color:var(--red);font-weight:600;font-size:14px">${UI.escapeHtml(msg)}</div>` : '';
    };
    document.getElementById('ed-cancel').onclick = () => openDetail(r);
    document.getElementById('ed-save').onclick = async () => {
      showErr('');
      const rc = editor.collect();
      const fd = new FormData();
      if (isManual) {
        const v = Number(document.getElementById('ed-valor').value) || 0;
        if (!(v > 0)) return showErr('Informe o valor de créditos desejado.');
        fd.append('creditosManuais', String(v));
      }
      fd.append('message', document.getElementById('ed-msg').value || '');
      fd.append('existing', JSON.stringify(rc.existing || []));
      rc.files.forEach(f => fd.append('comprovantes', f));
      fd.append('valores', JSON.stringify(rc.valores));
      fd.append('datas', JSON.stringify(rc.datas));
      const btn = document.getElementById('ed-save');
      try {
        if (btn) btn.disabled = true;
        const resp = await fetch(`/api/credit-requests/${r.id}`, { method: 'PUT', credentials: 'include', body: fd });
        if (!resp.ok) { const j = await resp.json().catch(() => null); throw new Error(j?.error || j?.message || `HTTP ${resp.status}`); }
        UI.toast('Rascunho atualizado'); UI.closeModal(); render();
      } catch (e) { showErr(e.message); if (btn) btn.disabled = false; }
    };
  }

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
            <small class="muted">Pode concluir sem anexo.</small>
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
