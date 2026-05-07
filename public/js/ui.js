// Helpers de UI: toast, modal, formatação, render de tabelas.
window.UI = (() => {
  const toastEl = document.getElementById('toast');
  const modalBg = document.getElementById('modal-bg');
  const modalTitle = document.getElementById('modal-title');
  const modalBody  = document.getElementById('modal-body');

  function toast(msg, kind='ok') {
    toastEl.className = `toast show ${kind}`;
    toastEl.textContent = msg;
    setTimeout(() => toastEl.className = 'toast', 3000);
  }

  function openModal(title, html) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalBg.classList.remove('hidden');
  }
  function closeModal() { modalBg.classList.add('hidden'); modalBody.innerHTML = ''; }
  document.getElementById('modal-close').onclick = closeModal;
  modalBg.addEventListener('click', e => { if (e.target === modalBg) closeModal(); });

  const fmtMoney = v => (v === null || v === undefined || isNaN(v))
    ? '—'
    : (v < 0 ? '-' : '') + 'R$ ' + Math.abs(Number(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtNum = v => (v === null || v === undefined || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-BR');

  const fmtDate = v => {
    if (!v) return '—';
    const d = new Date(v); if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR');
  };
  const fmtDateTime = v => {
    if (!v) return '—';
    const d = new Date(v); if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR');
  };

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function table({ cols, rows, empty='Sem registros' }) {
    if (!rows || !rows.length) return `<div class="muted small" style="padding:1rem">${empty}</div>`;
    const thead = cols.map(c => `<th class="${c.align==='right'?'num':''}">${escapeHtml(c.label)}</th>`).join('');
    const trs = rows.map(r => {
      const tds = cols.map(c => {
        const raw = typeof c.get === 'function' ? c.get(r) : r[c.key];
        const html = c.html ? raw : escapeHtml(raw);
        return `<td class="${c.align==='right'?'num':''}">${html ?? ''}</td>`;
      }).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<table class="table"><thead><tr>${thead}</tr></thead><tbody>${trs}</tbody></table>`;
  }

  return { toast, openModal, closeModal, fmtMoney, fmtNum, fmtDate, fmtDateTime, escapeHtml, table };
})();
