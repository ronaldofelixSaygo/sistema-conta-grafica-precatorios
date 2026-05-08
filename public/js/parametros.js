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
        <button class="btn ${activeTab==='email'?'primary':''}"      data-tab="email">E-mail (SMTP)</button>
      </div>
      <div id="param-content"></div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { activeTab = b.dataset.tab; render(); });
    if (activeTab === 'permissoes') return loadPerms();
    if (activeTab === 'email')      return loadEmail();
    return loadStages();
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
    c.innerHTML = `
      <div class="panel">
        <h3>Configuração SMTP</h3>
        <p class="muted small" style="margin-bottom:1rem">
          O sistema envia e-mails automáticos quando uma etapa do Kanban muda, quando uma etapa
          é concluída, e quando um cliente faz uma solicitação. Configure o SMTP da Saygo abaixo.
        </p>
        <form id="email-form" class="form-grid">
          <div class="full"><label><input type="checkbox" name="enabled" ${s.enabled?'checked':''}> Ativar envio de e-mails</label></div>
          <div><label>Servidor SMTP *</label><input name="host" value="${UI.escapeHtml(s.host||'')}" placeholder="ex: smtp.gmail.com"></div>
          <div><label>Porta *</label><input type="number" name="port" value="${s.port||587}"></div>
          <div class="full"><label><input type="checkbox" name="secure" ${s.secure?'checked':''}> SSL/TLS (porta 465)</label></div>
          <div><label>Usuário *</label><input name="user" value="${UI.escapeHtml(s.user||'')}" placeholder="ex: noreply@saygogroup.com.br"></div>
          <div><label>Senha</label><input type="password" name="pass" value="${s.pass==='***'?'***':''}" placeholder="(deixe ${s.pass==='***'?'*** para manter':'em branco'})"></div>
          <div><label>E-mail remetente</label><input name="fromAddress" value="${UI.escapeHtml(s.fromAddress||'')}" placeholder="noreply@saygogroup.com.br"></div>
          <div><label>Nome remetente</label><input name="fromName" value="${UI.escapeHtml(s.fromName||'')}" placeholder="Sistema Conta Gráfica - Saygo"></div>

          <div class="full" style="border-top:1px solid var(--bd);padding-top:.6rem;margin-top:.4rem">
            <strong style="font-size:11px;color:var(--t3);text-transform:uppercase">Quando enviar</strong>
          </div>
          <div class="full"><label><input type="checkbox" name="notifyKanbanStageChange" ${s.notifyKanbanStageChange?'checked':''}> Mudança de etapa no Kanban</label></div>
          <div class="full"><label><input type="checkbox" name="notifyKanbanStageDone"   ${s.notifyKanbanStageDone?'checked':''}> Conclusão de etapa no Kanban</label></div>
          <div class="full"><label><input type="checkbox" name="notifyPartnerRequest"    ${s.notifyPartnerRequest?'checked':''}> Nova solicitação (acionamento)</label></div>

          <div class="full form-actions">
            <button type="button" class="btn" id="email-test">Enviar e-mail de teste</button>
            <button type="submit" class="btn primary">Salvar</button>
          </div>
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
      const data = {
        enabled: !!fd.get('enabled'),
        host: fd.get('host'),
        port: Number(fd.get('port')) || 587,
        secure: !!fd.get('secure'),
        user: fd.get('user'),
        pass: fd.get('pass'),
        fromAddress: fd.get('fromAddress'),
        fromName: fd.get('fromName'),
        notifyKanbanStageChange: !!fd.get('notifyKanbanStageChange'),
        notifyKanbanStageDone:   !!fd.get('notifyKanbanStageDone'),
        notifyPartnerRequest:    !!fd.get('notifyPartnerRequest'),
      };
      try { await API.put('/api/email/settings', data); UI.toast('SMTP salvo'); loadEmail(); }
      catch (e) { UI.toast(e.message, 'err'); }
    };
    document.getElementById('email-test').onclick = async () => {
      const to = prompt('Enviar e-mail de teste para:', AUTH.user()?.email || '');
      if (!to) return;
      try { await API.post('/api/email/test', { to }); UI.toast('E-mail enviado (verifique)'); loadEmail(); }
      catch (e) { UI.toast(e.message, 'err'); }
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
