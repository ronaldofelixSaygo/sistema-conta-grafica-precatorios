window.VIEW_parametros = (() => {
  let perms = [], permsMeta = null;
  let stages = [];
  let activeTab = 'permissoes';

  // Mapa de campos disponíveis para "restringir" por entidade.
  // Adicione aqui campos sensíveis que o Adm poderá ocultar para cada perfil.
  const SENSITIVE_FIELDS_BY_MODULE = {
    clientes: [
      { key: 'cnpj',                label: 'CNPJ' },
      { key: 'cnpjFilial',          label: 'CNPJ filial' },
      { key: 'percentualComissao',  label: '% Comissão' },
      { key: 'diaFechamento',       label: 'Dia fechamento' },
      { key: 'observacoes',         label: 'Observações' },
      { key: 'parceiroSala',        label: 'Interveniente sala' },
      { key: 'parceiroFilial',      label: 'Interveniente filial' },
      { key: 'parceiroIe',          label: 'Interveniente IE' },
      { key: 'locacaoSala',         label: 'Status locação sala' },
      { key: 'aberturaFilial',      label: 'Status filial/empresa' },
      { key: 'reativacaoIe',        label: 'Status reativação IE' },
      { key: 'contaGrafica',        label: 'Status conta gráfica' },
      { key: 'clienteCertificado',  label: 'Cliente certificado' },
    ],
    movimentacoes: [
      { key: 'percentual',     label: '%' },
      { key: 'valor',          label: 'Valor bruto' },
      { key: 'valorAjustado',  label: 'Valor ajustado' },
      { key: 'parceiro',       label: 'Interveniente' },
    ],
  };

  async function render() {
    const el = document.getElementById('view-parametros');
    el.innerHTML = `
      <div style="display:flex;gap:.4rem;margin-bottom:1rem;border-bottom:1px solid var(--bd);padding-bottom:.5rem;flex-wrap:wrap">
        <button class="btn ${activeTab==='permissoes'?'primary':''}" data-tab="permissoes">Permissões</button>
        <button class="btn ${activeTab==='etapas'?'primary':''}"     data-tab="etapas">Etapas e Atividades</button>
        <button class="btn ${activeTab==='email'?'primary':''}"      data-tab="email">E-mail</button>
        <button class="btn ${activeTab==='ia'?'primary':''}"          data-tab="ia">IA (extração de invoice)</button>
        <button class="btn ${activeTab==='ncm'?'primary':''}"         data-tab="ncm">NCM / Anuentes</button>
      </div>
      <div id="param-content"></div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { activeTab = b.dataset.tab; render(); });
    if (activeTab === 'permissoes') return loadPerms();
    if (activeTab === 'email')      return loadEmail();
    if (activeTab === 'ia')         return loadIa();
    if (activeTab === 'ncm')        return loadNcm();
    return loadStages();
  }

  // ===== NCM / Anuentes =====
  async function loadNcm() {
    const c = document.getElementById('param-content');
    c.innerHTML = `
      <div class="panel">
        <h3>📋 Dataset de NCM, Anuentes e ICMS por UF</h3>
        <p class="muted small" style="margin-bottom:1rem">
          O sistema usa um dataset starter com ~40 NCMs comuns + ~46 regras de anuentes (ANATEL, ANVISA, MAPA, INMETRO, IBAMA, ANP, Exército) e alíquota interna de ICMS para 27 UFs.
          O lookup faz fallback hierárquico (8→6→4→2 dígitos), então um NCM não cadastrado cai na regra do capítulo dele.
        </p>
        <div id="ncm-counts" class="muted small" style="margin-bottom:1rem">Carregando contagens...</div>
        <div class="form-actions">
          <button class="btn primary" id="ncm-seed-btn">🌱 Popular dataset (starter ~40)</button>
          <button class="btn" id="ncm-test-btn">🔍 Testar lookup</button>
        </div>

        <div style="border-top:1px solid var(--bd);padding-top:.8rem;margin-top:1rem">
          <h4 style="margin:0 0 .4rem">📤 Importar dados oficiais</h4>
          <p class="muted small" style="margin-bottom:.6rem">
            Faça upload de CSV ou XLSX com dados oficiais. Detecta colunas automaticamente.
          </p>

          <div style="background:var(--s2);padding:.8rem;border-radius:6px;margin-bottom:.6rem">
            <strong style="font-size:13px">📦 TIPI (IPI por NCM)</strong>
            <div class="muted small" style="margin:4px 0 8px">
              Colunas esperadas: <code>ncm, descricao, ipi_aliq</code> (+ pis_aliq, cofins_aliq opcional). Substitui IPI/Descrição mantendo II existente.
              <a href="https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/legislacao/documentos-e-arquivos/tipi.xlsx" target="_blank">↗ Baixar TIPI oficial</a>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <input type="file" id="ncm-import-tributos-file" accept=".csv,.xlsx,.xls,.tsv" style="max-width:280px">
              <button class="btn primary" data-import="tributos">Importar TIPI</button>
            </div>
          </div>

          <div style="background:var(--s2);padding:.8rem;border-radius:6px;margin-bottom:.6rem">
            <strong style="font-size:13px">🌎 TEC (II por NCM)</strong>
            <div class="muted small" style="margin:4px 0 8px">
              Colunas: <code>ncm, ii_aliq</code> (ou ncm, tec). Atualiza apenas o II (Imposto de Importação) sem mexer em IPI/PIS/COFINS.
              <a href="https://www.gov.br/siscomex/pt-br/informacoes/tarifa-externa-comum-tec" target="_blank">↗ TEC Mercosul</a>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <input type="file" id="ncm-import-tec-file" accept=".csv,.xlsx,.xls,.tsv" style="max-width:280px">
              <button class="btn primary" data-import="tec">Importar TEC (II)</button>
            </div>
          </div>

          <div style="background:var(--s2);padding:.8rem;border-radius:6px;margin-bottom:.6rem">
            <strong style="font-size:13px">🏛 Anuentes (Tratamento Administrativo)</strong>
            <div class="muted small" style="margin:4px 0 8px">
              Colunas: <code>ncm, anuente, descricao, obrigatorio</code>. ⚠ Substitui completamente a tabela de anuentes.
              <a href="https://siscomex.desenvolvimento.gov.br/tratamento/" target="_blank">↗ Tratamento Administrativo</a>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <input type="file" id="ncm-import-anuentes-file" accept=".csv,.xlsx,.xls,.tsv" style="max-width:280px">
              <button class="btn primary" data-import="anuentes">Importar Anuentes</button>
            </div>
          </div>
        </div>

        <div id="ncm-out" style="margin-top:.6rem"></div>
      </div>`;

    // contagens iniciais
    refreshNcmCounts();

    document.getElementById('ncm-seed-btn').onclick = async () => {
      if (!confirm('Popular o dataset de NCM/anuentes/UF? Operação idempotente — não sobrescreve NCMs já editados, mas recria a tabela de anuentes.')) return;
      const out = document.getElementById('ncm-out');
      out.innerHTML = '<div class="muted">Populando dataset (até 30s)...</div>';
      try {
        const r = await API.post('/api/admin/seed-ncm');
        out.innerHTML = `
          <div class="pill green">✓ Dataset populado</div>
          <pre style="background:var(--s2);padding:.6rem;border-radius:6px;font-size:11px;margin-top:.4rem">${UI.escapeHtml(JSON.stringify(r, null, 2))}</pre>`;
        refreshNcmCounts();
      } catch (e) {
        out.innerHTML = `<div class="err">Falhou: ${UI.escapeHtml(e.message)}</div>`;
      }
    };

    document.getElementById('ncm-test-btn').onclick = async () => {
      const ncm = prompt('NCM (ex: 8517.62.59):', '85176259');
      if (!ncm) return;
      const uf = prompt('UF (ex: AL):', 'AL') || 'AL';
      const out = document.getElementById('ncm-out');
      out.innerHTML = '<div class="muted">Consultando...</div>';
      try {
        const r = await API.get(`/api/ncm/${ncm.replace(/\D/g,'')}`, { uf });
        out.innerHTML = `<pre style="background:var(--s2);padding:.6rem;border-radius:6px;font-size:11px">${UI.escapeHtml(JSON.stringify(r, null, 2))}</pre>`;
      } catch (e) {
        out.innerHTML = `<div class="err">${UI.escapeHtml(e.message)}</div>`;
      }
    };

    // Handler genérico pra os 3 imports
    document.querySelectorAll('[data-import]').forEach(btn => {
      btn.onclick = async () => {
        const modo = btn.dataset.import; // tributos | tec | anuentes
        const inputId = `ncm-import-${modo}-file`;
        const file = document.getElementById(inputId)?.files[0];
        if (!file) return UI.toast('Selecione um arquivo CSV ou XLSX', 'err');
        const out = document.getElementById('ncm-out');
        out.innerHTML = `<div class="muted">Importando ${modo}... pode levar até 1 minuto</div>`;
        const fd = new FormData();
        fd.append('file', file);
        fd.append('modo', modo);
        try {
          const resp = await fetch('/api/admin/ncm-import', {
            method: 'POST', credentials: 'include', body: fd,
          });
          if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(errText || `HTTP ${resp.status}`);
          }
          const r = await resp.json();
          out.innerHTML = `
            <div class="pill green">✓ Import (${modo}) concluído</div>
            <pre style="background:var(--s2);padding:.6rem;border-radius:6px;font-size:11px;margin-top:.4rem">${UI.escapeHtml(JSON.stringify(r, null, 2))}</pre>`;
        } catch (e) {
          out.innerHTML = `<div class="err">${UI.escapeHtml(e.message)}</div>`;
        }
      };
    });
  }

  async function refreshNcmCounts() {
    const div = document.getElementById('ncm-counts');
    if (!div) return;
    try {
      const r = await API.get('/api/ncm/00');  // qualquer; só pra forçar conexão
      div.innerHTML = `Pronto. (Use "Testar lookup" pra consultar um NCM específico.)`;
    } catch {
      div.innerHTML = `<span class="err">Erro ao acessar /api/ncm — pode estar com tabelas vazias. Clique em "Popular dataset".</span>`;
    }
  }

  // ===== IA (provider / model / apiKey / systemPrompt + versões do prompt) =====
  async function loadIa() {
    const c = document.getElementById('param-content');
    c.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      const [s, versions] = await Promise.all([
        API.get('/api/credit-requests/ai/settings'),
        API.get('/api/credit-requests/ai/prompt/versions').catch(() => []),
      ]);
      drawIa(s, versions);
    } catch (e) { c.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  function drawIa(s, versions) {
    const c = document.getElementById('param-content');
    c.innerHTML = `
      <div class="panel">
        <h3>🤖 IA — Configuração</h3>
        <p class="muted small" style="margin-bottom:1rem">
          Provedor de IA usado para ler PDFs de invoice e extrair os dados de cálculo.
          Mesmo padrão multi-provider do projeto Indicadores Comercial Bitrix.
        </p>
        <form id="ia-form" class="form-grid" autocomplete="off">
          <input type="text" style="display:none" autocomplete="username">
          <input type="password" style="display:none" autocomplete="new-password">
          <div class="full">
            <label><strong>ai_provider</strong></label>
            <select name="provider" id="ia-provider-select">
              <option value="anthropic" ${s.provider==='anthropic'?'selected':''}>anthropic</option>
              <option value="openai"    ${s.provider==='openai'?'selected':''}>openai</option>
              <option value="gemini"    ${s.provider==='gemini'?'selected':''}>gemini</option>
              <option value="groq"      ${s.provider==='groq'?'selected':''}>groq</option>
            </select>
            <small class="muted">Provedor de IA. <span id="ia-provider-hint"></span></small>
          </div>
          <div class="full">
            <label><strong>ai_model</strong></label>
            <input name="model" value="${UI.escapeHtml(s.model||'')}" placeholder="ex: claude-sonnet-4-5, gpt-4o-mini, gemini-2.5-flash, llama-3.3-70b-versatile" autocomplete="off">
            <small class="muted">Modelo (vazio = padrão do provider).</small>
          </div>
          <div class="full">
            <label><strong>ai_api_key</strong>
              ${s.hasApiKey
                ? `<span class="pill green" style="margin-left:.4rem">✓ key salva${s.updatedAt ? ` em ${UI.fmtDateTime(s.updatedAt)}` : ''}</span>`
                : '<span class="pill amber" style="margin-left:.4rem">não configurada</span>'}
            </label>
            <input type="password" id="ia-apikey-input" name="apiKey" value="" placeholder="${s.hasApiKey?'(deixe em branco para manter a atual)':'cole a API key'}" autocomplete="new-password">
            <small class="muted">API key do provedor (sensível). <span id="ia-apikey-hint"></span></small>
            <div id="ia-apikey-warn" class="err small" style="display:none;margin-top:4px"></div>
          </div>
          <div class="full">
            <label class="ai-toggle">
              <input type="checkbox" name="enabled" ${s.enabled?'checked':''}>
              <span><strong>Ativar IA</strong></span>
            </label>
          </div>

          <div class="full form-actions">
            <button type="submit" class="btn primary">Salvar</button>
          </div>
          <div class="full" id="ia-feedback"></div>
        </form>
      </div>

      <div class="panel">
        <h3>📝 ai_system_prompt</h3>
        <p class="muted small" style="margin-bottom:1rem">
          Prompt usado para extrair os campos da invoice. Edite e clique em "Salvar como nova versão" — o sistema mantém histórico.
        </p>
        <div id="ia-prompt"></div>
      </div>

      <div class="panel">
        <h3>Versões do prompt</h3>
        <div id="ia-versions"></div>
      </div>`;

    // Dicas e validação dinâmicas: provider × formato esperado de key
    const PROVIDER_KEY_INFO = {
      anthropic: { prefix: 'sk-ant-', label: 'Anthropic Claude', example: 'sk-ant-api03-...' },
      openai:    { prefix: 'sk-',     label: 'OpenAI',           example: 'sk-... ou sk-proj-...' },
      gemini:    { prefix: 'AIzaSy',  label: 'Google Gemini',    example: 'AIzaSy...' },
      groq:      { prefix: 'gsk_',    label: 'Groq',             example: 'gsk_...' },
    };
    const providerSel = document.getElementById('ia-provider-select');
    const hintEl = document.getElementById('ia-provider-hint');
    const keyHintEl = document.getElementById('ia-apikey-hint');
    const keyWarnEl = document.getElementById('ia-apikey-warn');
    const keyInput = document.getElementById('ia-apikey-input');
    const refreshHints = () => {
      const info = PROVIDER_KEY_INFO[providerSel.value] || PROVIDER_KEY_INFO.anthropic;
      hintEl.textContent = `(${info.label} — chave começa com "${info.prefix}")`;
      keyHintEl.textContent = `Formato esperado: ${info.example}`;
      // Valida key digitada (se houver) contra o prefix do provider
      const k = (keyInput.value || '').trim();
      if (k && !k.startsWith(info.prefix)) {
        keyWarnEl.style.display = 'block';
        keyWarnEl.textContent = `⚠ Esta key não parece ser do provider "${info.label}" (esperado prefixo "${info.prefix}"). Confira o provider acima.`;
      } else {
        keyWarnEl.style.display = 'none';
      }
    };
    providerSel.addEventListener('change', refreshHints);
    keyInput.addEventListener('input', refreshHints);
    refreshHints();

    document.getElementById('ia-form').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const keyVal = (fd.get('apiKey') || '').trim();
      const provider = fd.get('provider');
      const data = {
        provider,
        model:    (fd.get('model') || '').trim(),
        enabled:  !!fd.get('enabled'),
      };
      if (keyVal) data.apiKey = keyVal; // só envia se foi digitada nova; vazio = mantém
      // Validação client-side: prevent salvar provider+key incompatíveis
      const info = PROVIDER_KEY_INFO[provider];
      if (keyVal && info && !keyVal.startsWith(info.prefix)) {
        const ok = confirm(`A key não parece ser do provider "${info.label}" (esperado começar com "${info.prefix}").\n\nSalvar mesmo assim?`);
        if (!ok) return;
      }
      const fb = document.getElementById('ia-feedback');
      fb.innerHTML = '';
      try { await API.put('/api/credit-requests/ai/settings', data); UI.toast('IA salva'); loadIa(); }
      catch (e) {
        UI.toast(e.message, 'err');
        fb.innerHTML = `<div class="err" style="margin-top:.5rem">Erro ao salvar: ${UI.escapeHtml(e.message)}</div>`;
      }
    };

    drawPromptEditor();
    drawVersions(versions);
  }

  async function drawPromptEditor() {
    const cur = await API.get('/api/credit-requests/ai/prompt/active').catch(() => ({ content: '' }));
    const div = document.getElementById('ia-prompt');
    div.innerHTML = `
      <textarea id="ia-prompt-text" rows="14" style="width:100%;font-family:ui-monospace,monospace;font-size:12px">${UI.escapeHtml(cur.content||'')}</textarea>
      <div class="full"><label>Notas (opcional, ex.: "ajuste pra invoice da China")</label>
        <input id="ia-prompt-notes" placeholder="">
      </div>
      <div class="form-actions" style="margin-top:.5rem">
        <button class="btn primary" id="ia-prompt-save">Salvar como nova versão</button>
        ${cur.version ? `<span class="muted small">Versão ativa: <strong>v${cur.version}</strong></span>` : '<span class="muted small">(nenhuma versão salva — usando default)</span>'}
      </div>`;
    document.getElementById('ia-prompt-save').onclick = async () => {
      const content = document.getElementById('ia-prompt-text').value;
      const notes   = document.getElementById('ia-prompt-notes').value;
      if (!content.trim()) return UI.toast('Prompt vazio','err');
      try { await API.post('/api/credit-requests/ai/prompt', { content, notes }); UI.toast('Nova versão ativa'); loadIa(); }
      catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  function drawVersions(versions) {
    const div = document.getElementById('ia-versions');
    if (!versions.length) { div.innerHTML = '<div class="muted small">Nenhuma versão criada — usando o prompt padrão do sistema.</div>'; return; }
    div.innerHTML = UI.table({
      cols: [
        { label: 'v', get: r => 'v' + r.version },
        { label: 'Data', get: r => UI.fmtDateTime(r.createdAt) },
        { label: 'Por', get: r => r.createdBy?.name || '—' },
        { label: 'Notas', get: r => r.notes || '—' },
        { label: 'Ativa?', html: true, get: r => r.active ? '<span class="pill green">Ativa</span>' : '<span class="pill">—</span>' },
        { label: 'Trecho', html: true, get: r => `<span class="muted small">${UI.escapeHtml((r.content||'').slice(0, 100))}${(r.content||'').length>100?'…':''}</span>` },
        { label: '', html: true, get: r => r.active ? '' : `<button class="btn small" data-act="${r.id}">Ativar</button>` },
      ],
      rows: versions,
    });
    div.onclick = async e => {
      const id = e.target.getAttribute('data-act');
      if (!id) return;
      try { await API.post(`/api/credit-requests/ai/prompt/${id}/activate`); UI.toast('Ativada'); loadIa(); }
      catch (er) { UI.toast(er.message, 'err'); }
    };
  }

  // ===== E-MAIL (SMTP) =====
  async function loadEmail() {
    const c = document.getElementById('param-content');
    c.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      const s = await API.get('/api/email/settings');
      const logs = await API.get('/api/email/logs').catch(() => []);
      drawEmail(s, logs);
    } catch (e) { c.innerHTML = `<div class="err">${e.message}</div>`; }
  }
  function drawEmail(s, logs) {
    const c = document.getElementById('param-content');
    const ROLES = ['ADM','SAYGO','PARTNER','CLIENT'];
    const ROLE_LABELS = { ADM:'Admin', SAYGO:'Saygo', PARTNER:'Interveniente', CLIENT:'Cliente' };
    const rolesRow = (groupKey, current = []) => `
      <div class="full" style="display:flex;flex-wrap:wrap;gap:8px;padding-left:1.2rem;margin-top:-2px">
        ${ROLES.map(r => `<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:2px 8px;background:var(--s2);border:1px solid var(--bd);border-radius:6px">
          <input type="checkbox" name="${groupKey}" value="${r}" ${current.includes(r)?'checked':''}> ${ROLE_LABELS[r]}
        </label>`).join('')}
      </div>`;
    c.innerHTML = `
      <div class="panel">
        <h3>📧 E-mail</h3>
        <p class="muted small" style="margin-bottom:1rem">
          O sistema dispara e-mails automáticos via API interna Saygo (mesmo padrão do projeto Indicadores Comercial Bitrix).
        </p>
        <form id="email-form" class="form-grid">
          <div class="full">
            <label><strong>email_enabled</strong></label>
            <select name="enabled">
              <option value="true"  ${s.enabled?'selected':''}>Sim</option>
              <option value="false" ${!s.enabled?'selected':''}>Não</option>
            </select>
            <small class="muted">Envio de e-mail ligado/desligado.</small>
          </div>

          <div class="full">
            <label><strong>email_api_url</strong></label>
            <input name="apiUrl" value="${UI.escapeHtml(s.apiUrl||'')}" placeholder="https://fn4lvdgkug.execute-api.sa-east-1.amazonaws.com/v1/send">
            <small class="muted">URL da API interna Saygo de envio de e-mail.</small>
          </div>

          <div class="full">
            <label><strong>email_api_token</strong>
              ${s.hasApiToken
                ? `<span class="pill green" style="margin-left:.4rem">✓ token salvo${s.updatedAt ? ` em ${UI.fmtDateTime(s.updatedAt)}` : ''}</span>`
                : '<span class="pill amber" style="margin-left:.4rem">não configurado</span>'}
            </label>
            <input type="password" name="apiToken" value="" placeholder="${s.hasApiToken ? '(deixe em branco para manter o atual)' : 'cole o x-access-token'}" autocomplete="new-password">
            <small class="muted">x-access-token da API de e-mail Saygo. Para trocar, digite o novo. Para manter, deixe em branco.</small>
          </div>

          <div class="full">
            <label><strong>email_sender</strong></label>
            <input name="sender" value="${UI.escapeHtml(s.sender||'')}" placeholder="ronaldo.felix@saygogroup.com.br">
            <small class="muted">Remetente do e-mail (campo "sender" da API Saygo).</small>
          </div>

          <div class="full">
            <label><strong>email_briefing_recipients</strong></label>
            <textarea name="briefingRecipients" rows="2" placeholder="ronaldo.felix@saygogroup.com.br; outro@exemplo.com">${UI.escapeHtml(s.briefingRecipients||'')}</textarea>
            <small class="muted">Lista fixa de destinatários para briefing diário. Separe por ; ou , .</small>
          </div>

          <div class="full" style="border-top:1px solid var(--bd);padding-top:.6rem;margin-top:.4rem">
            <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Triggers de notificação</strong>
            <div class="muted small" style="margin-top:.2rem">Marque os perfis que devem receber cada tipo de alerta.</div>
          </div>

          <div class="full"><label><input type="checkbox" name="notifyKanbanStageChange" ${s.notifyKanbanStageChange?'checked':''}> <strong>Mudança de etapa no Kanban</strong></label></div>
          ${rolesRow('notifyKanbanStageChangeRoles', s.notifyKanbanStageChangeRoles||[])}

          <div class="full"><label><input type="checkbox" name="notifyKanbanStageDone" ${s.notifyKanbanStageDone?'checked':''}> <strong>Conclusão de etapa no Kanban</strong></label></div>
          ${rolesRow('notifyKanbanStageDoneRoles', s.notifyKanbanStageDoneRoles||[])}

          <div class="full"><label><input type="checkbox" name="notifyPartnerRequest" ${s.notifyPartnerRequest?'checked':''}> <strong>Acionamento de interveniente</strong></label></div>
          ${rolesRow('notifyPartnerRequestRoles', s.notifyPartnerRequestRoles||[])}

          <div class="full"><label><input type="checkbox" name="notifyCreditRequest" ${s.notifyCreditRequest?'checked':''}> <strong>Solicitação de Créditos</strong></label></div>
          ${rolesRow('notifyCreditRequestRoles', s.notifyCreditRequestRoles||[])}

          <div class="full form-actions">
            <button type="button" class="btn" id="email-test">Enviar e-mail de teste</button>
            <span style="flex:1"></span>
            <button type="submit" class="btn primary">Salvar</button>
          </div>
          <div class="full" id="email-feedback"></div>
        </form>
      </div>

      <div class="panel">
        <h3>Histórico de envios</h3>
        ${UI.table({
          cols: [
            { label: 'Quando', get: r => UI.fmtDateTime(r.createdAt) },
            { label: 'Para', key: 'to' },
            { label: 'Assunto', key: 'subject' },
            { label: 'Status', html: true, get: r => r.status==='sent'
              ? '<span class="pill green">Enviado</span>'
              : `<span class="pill red" title="${UI.escapeHtml(r.error||'')}">Erro</span>` },
            { label: 'Contexto', key: 'context' },
          ],
          rows: logs.slice(0, 50),
          empty: 'Nenhum e-mail enviado ainda.',
        })}
      </div>`;

    document.getElementById('email-form').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      // Token: se vazio, NÃO envia (mantém o atual). Se preenchido, envia o novo.
      const tokenVal = (fd.get('apiToken') || '').trim();
      const data = {
        enabled: fd.get('enabled') === 'true',
        apiUrl:   fd.get('apiUrl') || '',
        sender:   fd.get('sender') || '',
        briefingRecipients: fd.get('briefingRecipients') || '',
        notifyKanbanStageChange: !!fd.get('notifyKanbanStageChange'),
        notifyKanbanStageDone:   !!fd.get('notifyKanbanStageDone'),
        notifyPartnerRequest:    !!fd.get('notifyPartnerRequest'),
        notifyCreditRequest:     !!fd.get('notifyCreditRequest'),
        notifyKanbanStageChangeRoles: fd.getAll('notifyKanbanStageChangeRoles'),
        notifyKanbanStageDoneRoles:   fd.getAll('notifyKanbanStageDoneRoles'),
        notifyPartnerRequestRoles:    fd.getAll('notifyPartnerRequestRoles'),
        notifyCreditRequestRoles:     fd.getAll('notifyCreditRequestRoles'),
      };
      if (tokenVal) data.apiToken = tokenVal;
      const fb = document.getElementById('email-feedback');
      fb.innerHTML = '';
      try { await API.put('/api/email/settings', data); UI.toast('Configuração salva'); loadEmail(); }
      catch (e) {
        UI.toast(e.message, 'err');
        fb.innerHTML = `<div class="err" style="margin-top:.5rem">Erro ao salvar: ${UI.escapeHtml(e.message)}</div>`;
      }
    };
    document.getElementById('email-test').onclick = async () => {
      const to = prompt('Enviar e-mail de teste para:', AUTH.user()?.email || '');
      if (!to) return;
      const fb = document.getElementById('email-feedback');
      fb.innerHTML = `<div class="muted small" style="margin-top:.5rem">Enviando teste...</div>`;
      try {
        const r = await API.post('/api/email/test', { to });
        UI.toast('E-mail enviado');
        fb.innerHTML = `<div class="pill green" style="margin-top:.5rem">✓ Enviado para ${UI.escapeHtml(to)}</div>
          ${r?.response ? `<pre style="background:var(--s2);padding:.5rem;border-radius:6px;font-size:11px;margin-top:.4rem;max-height:120px;overflow:auto">${UI.escapeHtml(r.response)}</pre>` : ''}`;
        loadEmail();
      }
      catch (e) {
        UI.toast('Falhou — veja detalhes abaixo', 'err');
        fb.innerHTML = `<div class="err" style="margin-top:.5rem">❌ Erro: ${UI.escapeHtml(e.message)}</div>`;
      }
    };
  }



  // ===== PERMISSOES =====
  async function loadPerms() {
    const c = document.getElementById('param-content');
    c.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      const r = await API.get('/api/permissions');
      perms = r.items; permsMeta = r.meta;
      drawPerms();
    } catch (e) { c.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  function findPerm(profile, mod) {
    return perms.find(p => p.role === profile.role
      && (p.partnerType || null) === (profile.partnerType || null)
      && p.module === mod);
  }

  function drawPerms() {
    const c = document.getElementById('param-content');
    const moduleLabels = {
      dashboard:'Painel', clientes:'Clientes', movimentacoes:'Movimentações',
      saldos:'Saldos', comissoes:'Comissões', relatorios:'Relatórios',
      alertas:'Alertas', kanban:'Kanban', acionamentos:'Acionamentos',
      'credit-requests':'Solicitação de Créditos',
      parceiros:'Intervenientes Aduaneiros', usuarios:'Usuários', auditoria:'Auditoria',
      chat:'Chat', parametros:'Parâmetros',
    };
    const profileLabels = {
      ADM: 'Administrador',
      SAYGO: 'Saygo',
      PARTNER_ESCRITORIO: 'Interveniente<br><small>Escritório</small>',
      PARTNER_ARMADOR:    'Interveniente<br><small>Armador Logístico</small>',
      PARTNER_OUTRO:      'Interveniente<br><small>Outro</small>',
      CLIENT: 'Cliente',
    };
    const profiles = permsMeta.PROFILES || [];
    c.innerHTML = `
      <div class="panel">
        <h3>Matriz de permissões por perfil</h3>
        <p class="muted small" style="margin-bottom:1rem">
          Marque o que cada perfil pode fazer em cada módulo.
          Para os módulos com campos sensíveis (Clientes, Movimentações), use o botão
          <strong>"Campos sensíveis"</strong> ao lado do nome do módulo para ocultar campos específicos
          do retorno por perfil.
        </p>
        <div style="overflow-x:auto">
          <table class="table">
            <thead>
              <tr>
                <th rowspan="2" style="vertical-align:bottom">Módulo</th>
                ${profiles.map(p => `<th colspan="4" style="text-align:center;border-left:1px solid var(--bd2);min-width:180px">${profileLabels[p.key]||p.key}</th>`).join('')}
              </tr>
              <tr>
                ${profiles.map(() => `
                  <th style="font-size:9px;border-left:1px solid var(--bd2)">VER</th>
                  <th style="font-size:9px">CRIAR</th>
                  <th style="font-size:9px">EDIT</th>
                  <th style="font-size:9px">EXCL</th>
                `).join('')}
              </tr>
            </thead>
            <tbody>
              ${permsMeta.MODULES.map(mod => {
                const cells = profiles.map(p => {
                  const r = findPerm(p, mod);
                  if (!r) return '<td>--</td>'.repeat(4);
                  const cb = (k) => `<input type="checkbox" data-pid="${r.id}" data-k="${k}" ${r[k]?'checked':''} ${p.key==='ADM'?'disabled':''}>`;
                  return `
                    <td style="text-align:center;border-left:1px solid var(--bd2)">${cb('canView')}</td>
                    <td style="text-align:center">${cb('canCreate')}</td>
                    <td style="text-align:center">${cb('canEdit')}</td>
                    <td style="text-align:center">${cb('canDelete')}</td>`;
                }).join('');
                const sensitiveBtn = SENSITIVE_FIELDS_BY_MODULE[mod]
                  ? `<button class="btn small ghost" data-sens-mod="${mod}" style="font-size:10px;margin-left:.4rem">Campos sensíveis</button>`
                  : '';
                return `<tr>
                  <td><strong>${moduleLabels[mod]||mod}</strong>${sensitiveBtn}</td>
                  ${cells}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:1rem;display:flex;gap:.5rem">
          <button class="btn primary" id="pe-save">Salvar alterações</button>
          <button class="btn" id="pe-reset">Restaurar padrões</button>
        </div>
      </div>`;
    document.getElementById('pe-save').onclick = savePerms;
    document.getElementById('pe-reset').onclick = async () => {
      if (!confirm('Restaurar permissões padrão?')) return;
      try { await API.post('/api/permissions/reset'); UI.toast('Restaurado'); loadPerms(); }
      catch (e) { UI.toast(e.message, 'err'); }
    };
    // Botões "Campos sensíveis"
    c.querySelectorAll('[data-sens-mod]').forEach(b => {
      b.onclick = () => openSensitiveModal(b.dataset.sensMod);
    });
  }

  async function savePerms() {
    const btn = document.getElementById('pe-save');
    if (!btn) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    // Coleta apenas checkboxes que NÃO estão disabled (ADM são fixos)
    const checks = document.querySelectorAll('[data-pid]:not([disabled])');
    const byPid = {};
    checks.forEach(c => {
      byPid[c.dataset.pid] = byPid[c.dataset.pid] || {};
      byPid[c.dataset.pid][c.dataset.k] = c.checked;
    });
    const entries = Object.entries(byPid);

    let ok = 0, fail = 0, errors = [];
    // Paraleliza em lotes de 10 pra não congestionar
    for (let i = 0; i < entries.length; i += 10) {
      const batch = entries.slice(i, i + 10);
      const results = await Promise.all(batch.map(([pid, body]) =>
        API.put(`/api/permissions/${pid}`, body)
          .then(() => ({ ok: true }))
          .catch(e => ({ ok: false, msg: e.message }))
      ));
      for (const r of results) {
        if (r.ok) ok++;
        else { fail++; errors.push(r.msg); }
      }
      // Atualiza progresso no botão
      btn.textContent = `Salvando ${Math.min(i + 10, entries.length)}/${entries.length}...`;
    }

    btn.disabled = false;
    btn.textContent = original;
    if (fail > 0) {
      console.error('Erros de salvamento:', errors);
      UI.toast(`${ok} salvo, ${fail} falha(s) — veja console`, 'err');
    } else {
      UI.toast(`${ok} permissões salvas com sucesso!`, 'ok');
    }
    // Recarrega a matriz para confirmar visualmente
    await loadPerms();
  }

  // ===== Campos Sensíveis (modal) =====
  function openSensitiveModal(mod) {
    const fields = SENSITIVE_FIELDS_BY_MODULE[mod] || [];
    const profiles = permsMeta.PROFILES || [];
    const profileLabels = {
      ADM:'Administrador', SAYGO:'Saygo',
      PARTNER_ESCRITORIO:'Interveniente Escritório',
      PARTNER_ARMADOR:'Interveniente Armador',
      PARTNER_OUTRO:'Interveniente Outro',
      CLIENT:'Cliente',
    };
    const rows = fields.map(f => {
      const cells = profiles.map(p => {
        const r = findPerm(p, mod);
        if (!r) return '<td>--</td>';
        const restricted = (r.restrictedFields || []).includes(f.key);
        const disabled = p.key === 'ADM' ? 'disabled' : '';
        return `<td style="text-align:center;border-left:1px solid var(--bd2)">
          <input type="checkbox" data-sf-pid="${r.id}" data-sf-field="${f.key}" ${restricted?'checked':''} ${disabled}>
        </td>`;
      }).join('');
      return `<tr><td><strong>${UI.escapeHtml(f.label)}</strong> <span class="muted small">${f.key}</span></td>${cells}</tr>`;
    }).join('');

    UI.openModal(`Campos sensíveis: ${mod}`, `
      <p class="muted small" style="margin-bottom:.6rem">
        Marque para <strong>ocultar</strong> o campo no retorno da API para o perfil.
        Útil quando o perfil pode ver a lista mas não deve ver certas colunas (ex.: % comissão).
      </p>
      <div style="overflow-x:auto">
        <table class="table">
          <thead>
            <tr>
              <th>Campo</th>
              ${profiles.map(p => `<th style="text-align:center;border-left:1px solid var(--bd2);min-width:120px">${profileLabels[p.key]||p.key}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="form-actions" style="margin-top:.8rem">
        <button class="btn" id="sf-cancel">Cancelar</button>
        <button class="btn primary" id="sf-save">Salvar restrições</button>
      </div>`);
    document.getElementById('sf-cancel').onclick = UI.closeModal;
    document.getElementById('sf-save').onclick = async () => {
      const byPid = {};
      document.querySelectorAll('[data-sf-pid]').forEach(c => {
        const pid = c.dataset.sfPid;
        byPid[pid] = byPid[pid] || [];
        if (c.checked) byPid[pid].push(c.dataset.sfField);
      });
      let ok=0, fail=0;
      for (const [pid, fields] of Object.entries(byPid)) {
        try { await API.put(`/api/permissions/${pid}`, { restrictedFields: fields }); ok++; }
        catch { fail++; }
      }
      // pra perms que não tinham checkbox (sem campos selecionados), também precisa enviar []
      // No loop acima, byPid só tem pids cujos checkboxes apareceram. Como todos os pids
      // dessa página apareceram (mesmo que vazios), o loop é completo.
      UI.toast(`${ok} salvo${fail?`, ${fail} falha(s)`:''}`, fail?'err':'ok');
      UI.closeModal();
      loadPerms();
    };
  }

  // ===== ETAPAS E ATIVIDADES =====
  async function loadStages() {
    const c = document.getElementById('param-content');
    c.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      stages = await API.get('/api/kanban/stages');
      drawStages();
    } catch (e) { c.innerHTML = `<div class="err">${e.message}</div>`; }
  }
  function drawStages() {
    const c = document.getElementById('param-content');
    c.innerHTML = `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
          <h3>Etapas e atividades do Kanban</h3>
          <button class="btn primary" id="add-stage">+ Nova etapa</button>
        </div>
        <p class="muted small" style="margin-bottom:1rem">
          Etapas inativas não aparecem no Kanban. Atividades inativas também ficam ocultas em novos cards.
          Excluir uma etapa só é possível se não houver cards usando ela.
        </p>
        ${stages.map(stageCard).join('')}
      </div>`;
    document.getElementById('add-stage').onclick = () => openStageForm();
    c.addEventListener('click', stageHandler);
  }
  function stageCard(s) {
    const acts = (s.activities || []).map(a => `
      <li class="param-act ${a.active?'':'inactive'}">
        <input type="text" data-cl-stage="${s.id}" data-act-edit="${a.id}" value="${UI.escapeHtml(a.label)}">
        <button class="btn small" data-act-save="${a.id}">Salvar</button>
        <button class="btn small ${a.active?'':'primary'}" data-act-toggle="${a.id}" data-active="${a.active}">${a.active?'Desativar':'Ativar'}</button>
        <button class="btn small danger" data-act-del="${a.id}">x</button>
      </li>`).join('');
    return `
      <div class="param-stage ${s.active?'':'inactive'}">
        <div class="param-stage-head">
          <div>
            <span class="param-stage-order">${s.order}</span>
            <strong>${UI.escapeHtml(s.label)}</strong>
            <span class="muted small" style="margin-left:.4rem">[${s.key}]</span>
            ${s.isFinal?'<span class="badge-final">FINAL</span>':''}
            ${s.active?'':'<span class="badge-inactive">INATIVA</span>'}
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap">
            <button class="btn small" data-stage-edit="${s.id}">Editar</button>
            <button class="btn small ${s.active?'':'primary'}" data-stage-toggle="${s.id}" data-active="${s.active}">${s.active?'Desativar':'Ativar'}</button>
            <button class="btn small danger" data-stage-del="${s.id}">Excluir</button>
          </div>
        </div>
        <div class="muted small" style="margin:.3rem 0 .6rem">
          SLA: ${s.slaHours}h * Responsável padrão: ${s.defaultResponsibleRole || '--'}
        </div>
        <ul class="param-act-list">${acts}</ul>
        <div class="param-act-add">
          <input type="text" id="add-act-${s.id}" placeholder="Nova atividade...">
          <button class="btn small primary" data-act-add="${s.id}">+ Adicionar atividade</button>
        </div>
      </div>`;
  }
  function openStageForm(stage = null) {
    const isNew = !stage;
    UI.openModal(isNew ? 'Nova etapa' : `Editar etapa "${stage.label}"`, `
      <form id="form-stg" class="form-grid">
        <div class="full"><label>Nome (label) *</label><input name="label" required value="${UI.escapeHtml(stage?.label||'')}"></div>
        ${isNew ? '<div class="full"><label>Chave (auto, opcional)</label><input name="key" placeholder="Ex: ONBOARDING (deixar vazio gera automaticamente)"></div>' : ''}
        <div><label>Ordem</label><input type="number" name="order" value="${stage?.order ?? 0}"></div>
        <div><label>SLA (horas)</label><input type="number" min="0" name="slaHours" value="${stage?.slaHours ?? 72}"></div>
        <div class="full"><label>Responsável padrão</label>
          <select name="defaultResponsibleRole">
            <option value=""        ${!stage?.defaultResponsibleRole?'selected':''}>--</option>
            <option value="SAYGO"   ${stage?.defaultResponsibleRole==='SAYGO'?'selected':''}>Saygo</option>
            <option value="PARTNER" ${stage?.defaultResponsibleRole==='PARTNER'?'selected':''}>Interveniente</option>
            <option value="CLIENT"  ${stage?.defaultResponsibleRole==='CLIENT'?'selected':''}>Cliente</option>
            <option value="ADM"     ${stage?.defaultResponsibleRole==='ADM'?'selected':''}>Adm</option>
          </select>
        </div>
        <div class="full"><label><input type="checkbox" name="isFinal" ${stage?.isFinal?'checked':''}> Etapa final (Concluido)</label></div>
        <div class="full"><label><input type="checkbox" name="active" ${stage===null||stage.active?'checked':''}> Ativa</label></div>
        <div class="full form-actions">
          <button type="button" class="btn" id="stg-cancel">Cancelar</button>
          <button type="submit" class="btn primary">Salvar</button>
        </div>
      </form>`);
    document.getElementById('stg-cancel').onclick = UI.closeModal;
    document.getElementById('form-stg').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const data = {
        label: fd.get('label'),
        key:   fd.get('key') || undefined,
        order: Number(fd.get('order')) || 0,
        slaHours: Number(fd.get('slaHours')) || 72,
        defaultResponsibleRole: fd.get('defaultResponsibleRole') || null,
        isFinal: !!fd.get('isFinal'),
        active:  !!fd.get('active'),
      };
      try {
        if (isNew) await API.post('/api/kanban/stages', data);
        else       await API.put(`/api/kanban/stages/${stage.id}`, data);
        UI.toast('Etapa salva'); UI.closeModal(); loadStages();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }
  async function stageHandler(ev) {
    const t = ev.target;
    const id = t.dataset.stageEdit || t.dataset.stageDel || t.dataset.stageToggle
            || t.dataset.actAdd || t.dataset.actSave || t.dataset.actDel || t.dataset.actToggle;
    if (!id) return;
    if (t.dataset.stageEdit) {
      const s = stages.find(x => x.id === id); openStageForm(s);
    } else if (t.dataset.stageDel) {
      if (!confirm('Excluir essa etapa?')) return;
      try { await API.del(`/api/kanban/stages/${id}`); UI.toast('Etapa excluída'); loadStages(); }
      catch (e) { UI.toast(e.message, 'err'); }
    } else if (t.dataset.stageToggle) {
      const isActive = t.dataset.active === 'true';
      try { await API.put(`/api/kanban/stages/${id}`, { active: !isActive }); UI.toast(isActive?'Inativada':'Ativada'); loadStages(); }
      catch (e) { UI.toast(e.message, 'err'); }
    } else if (t.dataset.actAdd) {
      const inp = document.getElementById('add-act-' + id);
      const label = inp.value.trim();
      if (!label) return;
      try { await API.post(`/api/kanban/stages/${id}/activities`, { label }); UI.toast('Atividade adicionada'); loadStages(); }
      catch (e) { UI.toast(e.message, 'err'); }
    } else if (t.dataset.actSave) {
      const inp = document.querySelector(`[data-act-edit="${id}"]`);
      const label = inp.value.trim();
      try { await API.put(`/api/kanban/activities/${id}`, { label }); UI.toast('Atividade atualizada'); loadStages(); }
      catch (e) { UI.toast(e.message, 'err'); }
    } else if (t.dataset.actDel) {
      if (!confirm('Excluir essa atividade?')) return;
      try { await API.del(`/api/kanban/activities/${id}`); UI.toast('Atividade excluída'); loadStages(); }
      catch (e) { UI.toast(e.message, 'err'); }
    } else if (t.dataset.actToggle) {
      const isActive = t.dataset.active === 'true';
      try { await API.put(`/api/kanban/activities/${id}`, { active: !isActive }); UI.toast(isActive?'Inativada':'Ativada'); loadStages(); }
      catch (e) { UI.toast(e.message, 'err'); }
    }
  }

  return { render };
})();
