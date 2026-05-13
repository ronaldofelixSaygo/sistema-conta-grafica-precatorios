window.VIEW_dashboard = (() => {
  let clientesCache = [];

  async function render() {
    const el = document.getElementById('view-dashboard');
    el.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      if (!clientesCache.length) {
        try { clientesCache = await API.get('/api/clientes', null, { ttl: 60000 }); } catch {}
      }
      const cliOpts = clientesCache.map(c =>
        `<option value="${c.id}">${UI.escapeHtml(c.nome)}</option>`).join('');
      el.innerHTML = `
        <div class="page-toolbar">
          <select id="d-cli">
            <option value="">Todos os clientes</option>${cliOpts}
          </select>
          <input id="d-ini" type="date" />
          <input id="d-fim" type="date" />
          <button class="btn" id="d-apply">Aplicar</button>
          <button class="btn" id="d-clear">Limpar</button>
        </div>
        <div id="d-kpis"></div>
        <div id="d-staff"></div>
        <div class="panel">
          <h3>Últimas movimentações</h3>
          <div id="d-table"></div>
        </div>`;
      document.getElementById('d-apply').onclick = load;
      document.getElementById('d-clear').onclick = () => {
        document.getElementById('d-cli').value = '';
        document.getElementById('d-ini').value = '';
        document.getElementById('d-fim').value = '';
        load();
      };
      load();
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  async function load() {
    const q = {
      cliente_id: document.getElementById('d-cli')?.value || '',
      data_ini:   document.getElementById('d-ini')?.value || '',
      data_fim:   document.getElementById('d-fim')?.value || '',
    };
    try {
      const d = await API.get('/api/dashboard', q);
      const t = d.totals || {};
      document.getElementById('d-kpis').innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="l">Clientes</div><div class="v">${UI.fmtNum(t.clientes)}</div></div>
          <div class="kpi b"><div class="l">Movimentações</div><div class="v">${UI.fmtNum(t.movimentacoes)}</div></div>
          <div class="kpi g"><div class="l">Créditos</div><div class="v val-pos">${UI.fmtMoney(t.creditos)}</div></div>
          <div class="kpi r"><div class="l">Débitos</div><div class="v val-neg">${UI.fmtMoney(t.debitos)}</div></div>
          <div class="kpi p"><div class="l">Saldo</div><div class="v">${UI.fmtMoney(t.saldo)}</div></div>
          ${AUTH.isAdm() ? `<div class="kpi a"><div class="l">Usuários</div><div class="v">${UI.fmtNum(t.users)}</div></div>` : ''}
        </div>`;
      // Bloco de indicadores extras (só pra ADM/SAYGO — vem com d.staff)
      renderStaffBlock(d.staff);

      document.getElementById('d-table').innerHTML = UI.table({
        cols: [
          { label: 'Cliente', key: 'cliente_nome' },
          { label: 'Escritório', key: 'escritorio' },
          { label: 'Tipo',    html: true, get: r => {
            const cls = (r.tipo_movimento||'').includes('Débito')?'red':'green';
            return `<span class="pill ${cls}">${UI.escapeHtml(r.tipo_movimento||'')}</span>`;
          }},
          { label: 'Data',    get: r => UI.fmtDate(r.data_nf || r.created_at) },
          { label: 'Valor',   align: 'right', html: true, get: r => {
            const v = r.valor_ajustado;
            return `<span class="${v<0?'val-neg':'val-pos'}">${UI.fmtMoney(v)}</span>`;
          }},
        ],
        rows: d.ultimas || [],
        empty: 'Sem movimentações no período.',
      });
    } catch (e) {
      document.getElementById('d-kpis').innerHTML = `<div class="err">${e.message}</div>`;
    }
  }

  // Labels amigáveis pros enums do banco
  const CREDIT_STATUS = {
    DRAFT: 'Rascunho', SENT: 'Enviada', IN_PROGRESS: 'Em andamento',
    RESOLVED: 'Concluída', CANCELLED: 'Cancelada', REJECTED: 'Rejeitada',
  };
  const DESON_STATUS = {
    EM_ANDAMENTO: 'Em andamento', AGUARDANDO_APROVACAO: 'Aguard. aprovação',
    CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada',
  };
  const DESON_STEP = {
    DOCS_DESPACHANTE: 'Docs do Despachante',
    EMISSAO_DMI: 'Emissão DMI',
    EMISSAO_NF: 'Emissão NFs',
    VALIDACAO_NF: 'Validação NFs',
    ENVIO_NF_OFICIAL: 'NFs Oficiais',
    PROTOCOLO_ICMS: 'Protocolo ICMS',
    CONCLUIDO: 'Concluído',
  };

  // Paleta consistente pras barras
  const BAR_COLORS = ['#3b82f6','#22c55e','#f59e0b','#ec4899','#a855f7','#14b8a6','#ef4444','#64748b'];

  function renderStaffBlock(staff) {
    const wrap = document.getElementById('d-staff');
    if (!wrap) return;
    if (!staff) { wrap.innerHTML = ''; return; }

    const { kanban, creditos, desoneracoes } = staff;

    wrap.innerHTML = `
      <div class="staff-grid">
        <div class="panel staff-panel">
          <div class="staff-head">
            <div>
              <h3>Kanban — cards por etapa</h3>
              <div class="muted small">${UI.fmtNum(kanban.total || 0)} cards no total</div>
            </div>
            ${renderSlaPill(kanban.sla, 'Etapas no SLA')}
          </div>
          ${renderBars(kanban.porEtapa, 'stage', 'count', 'Sem cards no período.')}
        </div>

        <div class="panel staff-panel">
          <div class="staff-head">
            <div>
              <h3>Solicitações de Crédito</h3>
              <div class="muted small">${UI.fmtNum(creditos.total || 0)} no período · <strong>${UI.fmtNum(creditos.emAberto || 0)} em aberto</strong></div>
            </div>
            ${renderSlaPill(creditos.sla, 'Fases no SLA')}
          </div>
          ${renderBars(creditos.porStatus, 'status', 'count', 'Sem solicitações no período.', s => CREDIT_STATUS[s] || s)}
        </div>

        <div class="panel staff-panel">
          <div class="staff-head">
            <div>
              <h3>Desonerações</h3>
              <div class="muted small">${UI.fmtNum(desoneracoes.total || 0)} no período · <strong>${UI.fmtNum(desoneracoes.emAberto || 0)} em aberto</strong></div>
            </div>
            ${renderSlaPill(desoneracoes.sla, 'Etapas no SLA')}
          </div>
          ${renderBars(desoneracoes.porStatus, 'status', 'count', 'Sem desonerações no período.', s => DESON_STATUS[s] || s)}
        </div>

        ${desoneracoes.porEtapaEmAberto?.length ? `
          <div class="panel staff-panel staff-panel-wide">
            <div class="staff-head">
              <div>
                <h3>Desonerações em aberto — por etapa</h3>
                <div class="muted small">Onde estão paradas as ${UI.fmtNum(desoneracoes.emAberto)} desonerações em andamento</div>
              </div>
            </div>
            ${renderBars(desoneracoes.porEtapaEmAberto, 'step', 'count', 'Sem desonerações em aberto.', s => DESON_STEP[s] || s)}
          </div>` : ''}
      </div>
    `;
  }

  // Pill colorida de aderência SLA (verde >= 90, âmbar >= 70, vermelho < 70).
  // Recebe { ok, total, percent }. Se total=0 ou percent=null, mostra "—".
  function renderSlaPill(sla, label) {
    if (!sla || sla.total === 0 || sla.percent == null) {
      return `<div class="sla-pill sla-empty" title="Sem dados no período">
                <div class="sla-pct">—</div>
                <div class="sla-label">${label}</div>
              </div>`;
    }
    const cls = sla.percent >= 90 ? 'sla-good' : (sla.percent >= 70 ? 'sla-warn' : 'sla-bad');
    return `<div class="sla-pill ${cls}" title="${sla.ok} de ${sla.total} dentro do prazo">
              <div class="sla-pct">${sla.percent}%</div>
              <div class="sla-label">${label}</div>
            </div>`;
  }

  // Render visual: barras horizontais com label + count.
  function renderBars(rows, keyField, valField, emptyMsg, labelMap) {
    if (!rows || !rows.length) {
      return `<div class="muted small" style="padding:.8rem 0">${emptyMsg}</div>`;
    }
    const max = Math.max(1, ...rows.map(r => r[valField] || 0));
    const sorted = [...rows].sort((a,b) => (b[valField]||0) - (a[valField]||0));
    return `
      <div class="bar-list">
        ${sorted.map((r, i) => {
          const label = labelMap ? labelMap(r[keyField]) : r[keyField];
          const val = r[valField] || 0;
          const pct = Math.round((val / max) * 100);
          const color = BAR_COLORS[i % BAR_COLORS.length];
          return `
            <div class="bar-row">
              <div class="bar-label" title="${UI.escapeHtml(label)}">${UI.escapeHtml(label)}</div>
              <div class="bar-track">
                <div class="bar-fill" style="width:${pct}%;background:${color}"></div>
              </div>
              <div class="bar-val">${UI.fmtNum(val)}</div>
            </div>`;
        }).join('')}
      </div>`;
  }

  return { render };
})();
