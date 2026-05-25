// Visualizador inline de anexos. Suporta PDF (iframe), imagens (img),
// e fallback "abrir nova aba" para outros tipos.
window.VIEWER = (() => {
  function open({ url, filename, mimeType }) {
    // remove qualquer viewer anterior
    document.getElementById('viewer-bg')?.remove();

    const safe = String(filename || 'arquivo').replace(/[<>"']/g, '');
    const ext = (filename || '').toLowerCase().split('.').pop();
    const isImage = (mimeType||'').startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg'].includes(ext);
    const isPdf   = (mimeType||'').includes('pdf') || ext === 'pdf';

    // URL pra forçar download (attachment): mesma rota com ?download=1.
    // Browsers ignoram o atributo "download" do <a> quando o href é
    // cross-origin (caso S3 após o redirect 302). Anexando ?download=1,
    // o backend gera a URL assinada do S3 com Content-Disposition=attachment
    // e o navegador baixa em vez de abrir.
    const dlUrl = url + (url.includes('?') ? '&' : '?') + 'download=1';

    const bg = document.createElement('div');
    bg.id = 'viewer-bg';
    bg.className = 'viewer-bg';
    bg.innerHTML = `
      <div class="viewer-modal">
        <header class="viewer-head">
          <strong>${safe}</strong>
          <div style="display:flex;gap:.4rem">
            <a class="btn small primary" href="${dlUrl}" download="${safe}">Baixar</a>
            <button class="btn small ghost" id="viewer-close">x</button>
          </div>
        </header>
        <div class="viewer-body" id="viewer-body"></div>
      </div>`;
    document.body.appendChild(bg);
    const body = document.getElementById('viewer-body');
    if (isImage) {
      body.innerHTML = `<img src="${url}" alt="${safe}" style="max-width:100%;max-height:100%;display:block;margin:auto"/>`;
    } else if (isPdf) {
      body.innerHTML = `<iframe src="${url}" style="width:100%;height:100%;border:0;background:#fff"></iframe>`;
    } else {
      body.innerHTML = `
        <div style="padding:2rem;text-align:center">
          <p>Tipo de arquivo nao suportado para preview.</p>
          <a class="btn primary" href="${url}" target="_blank" rel="noopener">Abrir em nova aba</a>
        </div>`;
    }
    document.getElementById('viewer-close').onclick = close;
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
  }
  function close() { document.getElementById('viewer-bg')?.remove(); }
  return { open, close };
})();
