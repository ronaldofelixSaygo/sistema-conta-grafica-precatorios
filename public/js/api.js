// Cliente HTTP fino. Usa cookie httpOnly para auth — não precisa armazenar token.
window.API = (() => {
  async function req(method, url, body, opts = {}) {
    const init = {
      method,
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    };
    if (body !== undefined && !(body instanceof FormData)) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    } else if (body instanceof FormData) {
      init.body = body;
    }
    const r = await fetch(url, init);
    if (opts.raw) return r;
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await r.json().catch(()=>({})) : await r.text();
    if (!r.ok) {
      const err = new Error((data && data.error) || `HTTP ${r.status}`);
      err.status = r.status; err.data = data; throw err;
    }
    return data;
  }
  function qs(obj) {
    const p = new URLSearchParams();
    Object.entries(obj || {}).forEach(([k,v]) => {
      if (v !== undefined && v !== null && v !== '') p.set(k, v);
    });
    const s = p.toString();
    return s ? `?${s}` : '';
  }
  return {
    get:  (u, q)  => req('GET',    u + qs(q)),
    post: (u, b)  => req('POST',   u, b),
    put:  (u, b)  => req('PUT',    u, b),
    del:  (u)     => req('DELETE', u),
    raw:  (m,u,b) => req(m, u, b, { raw: true }),
    qs,
  };
})();
