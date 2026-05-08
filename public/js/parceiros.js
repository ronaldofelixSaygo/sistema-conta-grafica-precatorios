window.VIEW_parceiros = (() => {
  let cache = [], stagesMeta = null;

  async function render() {
    const el = document.getElementById('view-parceiros');
    el.innerHTML = '<div class="muted">Carregando...</div>';
    try {
      [cache, stagesMeta] = await Promise.all([
        API.get('/api/parceiros'),
        API.get('/api/kanban/meta'),
      ]);
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <div class="muted small">${cache.length} parceiro(s)</div>
          <button class="btn primary" id="pa-new">+ Novo parceiro</button>
        </div>
        <div id="pa-table"></div>`;
      drawTable();
      document.getElementById('pa-new').onclick = () => openForm();
    } catch (e) { el.innerHTML = `<div class="err">${e.message}</div>`; }
  }

  function stageLabel(k) { return stagesMeta?.stageMeta?.[k]?.label || k; }

  function drawTable() {
    document.getElementById('pa-table').innerHTML = UI.table({
      cols: [
        { label: 'Nome', html: true, get: r => `${UI.escapeHtml(r.nome)}${r.isSaygo?' <span class="muted small">(Saygo)</span>':''}` },
        { label: 'Tipo', html: true, get: r => {
          const m = { ESCRITORIO:'Escritório', ARMADOR_LOGISTICO:'Armador', OUTRO:'Outro' };
          return `<span class="pill ${r.type||'OUTRO'}">${m[r.type||'OUTRO']}</span>`;
        }},
        { label: 'CNPJ', key: 'cnpj' },
        { label: 'Telefone', key: 'telefone' },
        { label: 'E-mail', key: 'email' },
        { label: 'Etapas', html: true, get: r =>
          (r.stages||[]).map(s => `<span style="background:var(--s3);padding:1px 6px;border-radius:10px;font-size:10px;margin-right:3px">${UI.escapeHtml(stageLabel(s))}</span>`).join('') || '<span class="muted small">--</span>'
        },
        { label: '', html: true, get: r =>
          `<div class="actions">
            <button class="btn small" data-edit="${r.id}">Editar</button>
            <button class="btn small danger" data-del="${r.id}">x</button>
          </div>` },
      ],
      rows: cache, empty: 'Nenhum parceiro cadastrado.',
    });
    const t = document.getElementById('pa-table');
    t.addEventListener('click', e => {
      const eid = e.target.getAttribute('data-edit');
      const did = e.target.getAttribute('data-del');
      if (eid) openForm(cache.find(p => p.id===eid));
      if (did) remove(did);
    });
  }

  function openForm(p = {}) {
    const isNew = !p.id;
    const stagesList = stagesMeta?.stagesOrder || [];
    const stagesChecks = stagesList.map(k => `
      <label style="display:flex;align-items:center;gap:.4rem;padding:4px 8px;background:var(--s2);border-radius:6px;border:1px solid var(--bd);cursor:pointer">
        <input type="checkbox" name="stages" value="${k}" ${p.stages?.includes(k)?'checked':''}>
        <span>${UI.escapeHtml(stageLabel(k))}</span>
      </label>`).join('');
    UI.openModal(isNew?'Novo parceiro':`Editar parceiro`, `
      <form id="form-pa" class="form-grid">
        <div class="full"><label>Nome *</label><input name="nome" required value="${UI.escapeHtml(p.nome||'')}"></div>
        <div><label>CNPJ</label><input name="cnpj" data-mask="cnpj" maxlength="18" value="${UI.escapeHtml(p.cnpj||'')}"></div>
        <div><label>Telefone</label><input name="telefone" data-mask="phone" maxlength="15" value="${UI.escapeHtml(p.telefone||'')}"></div>
        <div class="full"><label>E-mail</label><input type="email" name="email" value="${UI.escapeHtml(p.email||'')}"></div>
        <div class="full"><label>Tipo de Parceiro *</label>
          <select name="type" required>
            <option value="OUTRO"             ${(p.type||'OUTRO')==='OUTRO'?'selected':''}>Outro</option>
            <option value="ESCRITORIO"        ${p.type==='ESCRITORIO'?'selected':''}>Escritório (acessa clientes, movs, comissões)</option>
            <option value="ARMADOR_LOGISTICO" ${p.type==='ARMADOR_LOGISTICO'?'selected':''}>Armador Logístico (somente Kanban)</option>
          </select>
        </div>
        <div class="full"><label style="margin-bottom:.4rem">Etapas em que atua</label>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px">${stagesChecks || '<div class="muted small">Cadastre etapas em Parametros antes.</div>'}</div>
        </div>
        <div class="full"><label><input type="checkbox" name="isSaygo" ${p.isSaygo?'checked':''}> E a propria Saygo</label></div>
        <div class="full"><label>Observacoes</label><textarea name="notes" rows="2">${UI.escapeHtml(p.notes||'')}</textarea></div>
        <div class="full form-actions">
          <button type="button" class="btn" id="pa-cancel">Cancelar</button>
          <button type="submit" class="btn primary">Salvar</button>
        </div>
      </form>`);
    document.getElementById('pa-cancel').onclick = UI.closeModal;
    document.getElementById('form-pa').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const data = {
        nome: fd.get('nome'), cnpj: fd.get('cnpj'), telefone: fd.get('telefone'),
        email: fd.get('email'), notes: fd.get('notes'),
        type: fd.get('type') || 'OUTRO',
        isSaygo: !!fd.get('isSaygo'),
        stages: fd.getAll('stages'),
      };
      try {
        if (isNew) await API.post('/api/parceiros', data);
        else       await API.put(`/api/parceiros/${p.id}`, data);
        UI.toast('Parceiro salvo'); UI.closeModal(); render();
      } catch (e) { UI.toast(e.message, 'err'); }
    };
  }

  async function remove(id) {
    if (!confirm('Excluir parceiro?')) return;
    try { await API.del(`/api/parceiros/${id}`); UI.toast('Excluido'); render(); }
    catch (e) { UI.toast(e.message, 'err'); }
  }

  return { render };
})();
