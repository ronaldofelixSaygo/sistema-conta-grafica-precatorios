// Mascara CNPJ: 00.000.000/0000-00. Aplica em todo input com data-mask="cnpj".
window.MASK = (() => {
  function fmtCNPJ(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 14);
    let out = d;
    if (d.length > 2)  out = d.slice(0,2) + '.' + d.slice(2);
    if (d.length > 5)  out = out.slice(0,6) + '.' + out.slice(6);
    if (d.length > 8)  out = out.slice(0,10) + '/' + out.slice(10);
    if (d.length > 12) out = out.slice(0,15) + '-' + out.slice(15);
    return out;
  }
  function fmtPhone(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 10) {
      // (00) 0000-0000
      return d.replace(/(\d{2})(\d{4})(\d{0,4}).*/, (_, a, b, c) =>
        c ? `(${a}) ${b}-${c}` : b ? `(${a}) ${b}` : a ? `(${a}` : '');
    }
    // (00) 00000-0000
    return d.replace(/(\d{2})(\d{5})(\d{0,4}).*/, (_, a, b, c) => c ? `(${a}) ${b}-${c}` : `(${a}) ${b}`);
  }
  function bind(input, kind) {
    if (!input || input.dataset.maskBound === '1') return;
    input.dataset.maskBound = '1';
    if (kind === 'cnpj') input.value = fmtCNPJ(input.value);
    if (kind === 'phone') input.value = fmtPhone(input.value);
    input.addEventListener('input', () => {
      const start = input.selectionStart;
      const before = input.value;
      const f = kind === 'cnpj' ? fmtCNPJ : fmtPhone;
      input.value = f(input.value);
      // tenta manter cursor no fim
      const diff = input.value.length - before.length;
      try { input.setSelectionRange(start + diff, start + diff); } catch {}
    });
  }
  function bindAll(root = document) {
    root.querySelectorAll('input[data-mask="cnpj"]').forEach(i => bind(i, 'cnpj'));
    root.querySelectorAll('input[data-mask="phone"]').forEach(i => bind(i, 'phone'));
  }
  // re-aplica sempre que o modal abrir
  const obs = new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1) bindAll(n);
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  return { fmtCNPJ, fmtPhone, bindAll };
})();
