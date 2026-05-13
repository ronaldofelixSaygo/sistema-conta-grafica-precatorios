// =====================================================================
// Combobox pesquisável reutilizável.
// Transforma qualquer <select> longo num input com dropdown filtrável.
// - Auto-aplica em selects com mais de 10 opções (heurística)
// - Force com atributo `data-combo`
// - Pula com atributo `data-no-combo`
// - Observa o DOM: selects de modais abertos depois são pegos automaticamente
// - Sincroniza com o <select> original (dispatch 'change'), então handlers
//   existentes via .addEventListener('change', ...) continuam funcionando
// - Casa com ou sem acento (digita "doc contabil" → acha "DOC CONTÁBIL")
// - Respeita <option disabled>: mostra cinza, não permite selecionar
// =====================================================================
window.COMBO = (() => {
  const ENHANCED = new WeakSet();
  const MIN_OPTIONS_FOR_AUTO = 10;

  // Marcas combinantes Unicode (acentos decompostos): U+0300 a U+036F
  const _DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(_DIACRITICS_RE, '');
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function enhance(sel) {
    if (ENHANCED.has(sel)) return;
    if (sel.multiple || sel.size > 1) return;
    ENHANCED.add(sel);

    // Wrapper que substitui o <select> visualmente
    const wrap = document.createElement('div');
    wrap.className = 'combo-wrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('combo-hidden');

    // Input visível
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'combo-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    if (sel.disabled)    input.disabled = true;
    if (sel.placeholder) input.placeholder = sel.placeholder;
    wrap.appendChild(input);

    // Seta visual
    const caret = document.createElement('span');
    caret.className = 'combo-caret';
    caret.textContent = '▾';
    caret.addEventListener('mousedown', e => {
      e.preventDefault();
      if (drop.classList.contains('hidden')) { input.focus(); openDrop(''); }
      else closeDrop();
    });
    wrap.appendChild(caret);

    // Dropdown
    const drop = document.createElement('div');
    drop.className = 'combo-drop hidden';
    wrap.appendChild(drop);

    let items = [];        // todas as opções: [{value, text, normText, disabled}]
    let filtered = [];     // opções filtradas atualmente exibidas
    let highlighted = -1;

    function refreshItems() {
      items = [...sel.options].map(o => ({
        value: o.value,
        text: o.textContent.trim(),
        normText: norm(o.textContent),
        disabled: !!o.disabled,
      }));
    }

    function syncInputFromSelect() {
      refreshItems();
      const cur = items.find(i => i.value === sel.value);
      input.value = cur ? cur.text : '';
    }

    function openDrop(filter) {
      refreshItems();
      const f = norm(filter || '');
      filtered = f
        ? items.filter(i => i.normText.includes(f))
        : items.slice();
      drop.innerHTML = filtered.length
        ? filtered.map((i, idx) => {
            const cls = 'combo-item' + (i.disabled ? ' disabled' : '');
            const aria = i.disabled ? ' aria-disabled="true"' : '';
            return `<div class="${cls}" data-idx="${idx}"${aria}>${esc(i.text || ' ')}</div>`;
          }).join('')
        : '<div class="combo-empty">Nenhum resultado</div>';
      drop.classList.remove('hidden');
      // Tenta destacar a opção atual; senão a primeira NÃO disabled
      const curIdx = filtered.findIndex(i => i.value === sel.value && !i.disabled);
      const firstEnabled = filtered.findIndex(i => !i.disabled);
      highlighted = curIdx >= 0 ? curIdx : firstEnabled;
      updateHighlight();
    }

    function closeDrop() {
      drop.classList.add('hidden');
      filtered = [];
      highlighted = -1;
    }

    function updateHighlight() {
      const nodes = drop.querySelectorAll('.combo-item');
      nodes.forEach((el, i) => el.classList.toggle('hl', i === highlighted));
      if (highlighted >= 0 && nodes[highlighted]) {
        nodes[highlighted].scrollIntoView({ block: 'nearest' });
      }
    }

    // Move o highlight pulando items disabled. Wrap-around.
    function moveHighlight(dir) {
      if (!filtered.length) return;
      let i = highlighted < 0 ? -dir : highlighted;
      for (let step = 0; step < filtered.length; step++) {
        i = (i + dir + filtered.length) % filtered.length;
        if (!filtered[i].disabled) { highlighted = i; updateHighlight(); return; }
      }
    }

    function pick(value) {
      // Não selecionar items disabled
      const item = items.find(i => i.value === value);
      if (item?.disabled) return;
      sel.value = value;
      syncInputFromSelect();
      closeDrop();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel.dispatchEvent(new Event('input',  { bubbles: true }));
    }

    input.addEventListener('focus', () => openDrop(''));
    input.addEventListener('click', () => { if (drop.classList.contains('hidden')) openDrop(''); });
    input.addEventListener('input', () => openDrop(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (drop.classList.contains('hidden')) return openDrop(input.value);
        moveHighlight(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (drop.classList.contains('hidden')) return openDrop(input.value);
        moveHighlight(-1);
      } else if (e.key === 'Enter') {
        if (!drop.classList.contains('hidden') && filtered[highlighted] && !filtered[highlighted].disabled) {
          e.preventDefault();
          pick(filtered[highlighted].value);
        }
      } else if (e.key === 'Escape') {
        if (!drop.classList.contains('hidden')) {
          e.preventDefault();
          e.stopPropagation();
          closeDrop();
        }
      } else if (e.key === 'Tab') {
        // Se digitou um valor exato (não-disabled), seleciona ao sair
        const exact = items.find(i => i.normText === norm(input.value) && !i.disabled);
        if (exact && exact.value !== sel.value) pick(exact.value);
        closeDrop();
      }
    });
    input.addEventListener('blur', () => {
      // pequeno delay pra processar mousedown no item antes de fechar
      setTimeout(() => {
        const exact = items.find(i => i.normText === norm(input.value) && !i.disabled);
        if (!exact) syncInputFromSelect();
        closeDrop();
      }, 150);
    });
    // mousedown (não click) — click dispara depois do blur do input
    drop.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.combo-item');
      if (!item) return;
      e.preventDefault();
      if (item.classList.contains('disabled')) return;
      const idx = Number(item.dataset.idx);
      if (filtered[idx]) pick(filtered[idx].value);
    });

    // Reaplica quando options forem populadas dinamicamente
    const optObs = new MutationObserver(() => { syncInputFromSelect(); });
    optObs.observe(sel, { childList: true });

    // Inicial
    syncInputFromSelect();
  }

  function maybeEnhance(sel) {
    if (sel.classList.contains('combo-hidden')) return;
    if (sel.hasAttribute('data-no-combo')) return;
    if (!sel.hasAttribute('data-combo') && sel.options.length <= MIN_OPTIONS_FOR_AUTO) return;
    enhance(sel);
  }

  function scanAll(root = document.body) {
    root.querySelectorAll('select').forEach(maybeEnhance);
  }

  // Observa selects novos chegando no DOM (modais que abrem depois).
  // IMPORTANTE: também olha se o TARGET da mutação é um <select> existente
  // que ganhou options dinamicamente (caso típico: select renderizado vazio
  // e populado depois via fetch). Sem isso, selects populados após o render
  // inicial nunca viram combobox.
  const docObs = new MutationObserver((muts) => {
    for (const m of muts) {
      // 1) Selects existentes que ganharam (ou perderam) options
      if (m.target?.tagName === 'SELECT') {
        maybeEnhance(m.target);
      }
      // 2) Novos selects adicionados em qualquer lugar do body
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'SELECT') maybeEnhance(n);
        else n.querySelectorAll?.('select').forEach(maybeEnhance);
      }
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    scanAll();
    docObs.observe(document.body, { childList: true, subtree: true });
  });

  return { enhance, scanAll };
})();
