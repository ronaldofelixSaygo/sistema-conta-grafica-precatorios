// Cliente HTTP fino com cache TTL em memória.
// Mutations (POST/PUT/DELETE) invalidam o cache de GET por prefixo de URL.
window.API = (() => {
  const cache = new Map(); // url -> { data, expiresAt }

  async function req(method, url, body, opts = {}) {
    const init = {
      method,
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    };
    if (opts.noStore) init.cache = 'no-store';
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

  // GET com cache opcional (passe { ttl: 30000 } no 3o arg em milissegundos).
  // Quando ttl === 0, força fetch com `cache: 'no-store'` pra ignorar tanto o
  // cache em memória quanto qualquer cache HTTP do navegador / proxy.
  async function get(u, q, opts = {}) {
    const fullUrl = u + qs(q);
    const ttl = Number(opts.ttl) || 0;
    if (ttl > 0) {
      const c = cache.get(fullUrl);
      if (c && c.expiresAt > Date.now()) return c.data;
    }
    const data = await req('GET', fullUrl, undefined, { noStore: ttl === 0 });
    if (ttl > 0) cache.set(fullUrl, { data, expiresAt: Date.now() + ttl });
    return data;
  }

  // Invalida entradas de cache cujo URL começa com algum dos prefixos passados
  function invalidate(...prefixes) {
    if (!prefixes.length) { cache.clear(); return; }
    for (const k of [...cache.keys()]) {
      if (prefixes.some(p => k.startsWith(p))) cache.delete(k);
    }
  }

  // Mutations: invalidam por baseUrl (sem querystring)
  async function mutate(method, url, body) {
    const r = await req(method, url, body);
    // Invalida o próprio recurso e o "/" base (lista)
    const base = url.split('?')[0];
    const segments = base.split('/').filter(Boolean);
    // ex: /api/clientes/123 → invalida /api/clientes
    if (segments.length >= 2) {
      const parentUrl = '/' + segments.slice(0, segments.length - 1).join('/');
      invalidate(parentUrl, base);
    } else {
      invalidate(base);
    }
    return r;
  }

  return {
    get,
    post: (u, b) => mutate('POST',   u, b),
    put:  (u, b) => mutate('PUT',    u, b),
    del:  (u)    => mutate('DELETE', u),
    raw:  (m,u,b) => req(m, u, b, { raw: true }),
    qs,
    invalidate,
  };
})();
