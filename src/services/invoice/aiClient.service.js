// =====================================================================
// Wrapper multi-provider para chamadas de IA.
// Suporta: anthropic | openai | gemini | groq
// Recebe { provider, model, apiKey, systemPrompt, userMessage }
// Retorna { text, raw }
// =====================================================================

const DEFAULTS = {
  anthropic: 'claude-sonnet-4-5',
  openai:    'gpt-4o-mini',
  gemini:    'gemini-2.5-flash',
  groq:      'llama-3.3-70b-versatile',
};

function pickModel(provider, model) {
  return (model && String(model).trim()) || DEFAULTS[provider] || '';
}

async function callAnthropic({ apiKey, model, systemPrompt, userMessage }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: pickModel('anthropic', model),
      max_tokens: 4096,
      system: systemPrompt || undefined,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${j?.error?.message || JSON.stringify(j)}`);
  const text = (j.content || []).map(c => c.text || '').join('').trim();
  return { text, raw: j };
}

async function callOpenAICompat({ url, apiKey, model, systemPrompt, userMessage, providerLabel }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userMessage });
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${providerLabel} ${r.status}: ${j?.error?.message || JSON.stringify(j)}`);
  const text = j?.choices?.[0]?.message?.content?.trim() || '';
  return { text, raw: j };
}

async function callOpenAI(args) {
  return callOpenAICompat({
    url: 'https://api.openai.com/v1/chat/completions',
    providerLabel: 'OpenAI',
    ...args,
    model: pickModel('openai', args.model),
  });
}

async function callGroq(args) {
  return callOpenAICompat({
    url: 'https://api.groq.com/openai/v1/chat/completions',
    providerLabel: 'Groq',
    ...args,
    model: pickModel('groq', args.model),
  });
}

async function callGemini({ apiKey, model, systemPrompt, userMessage }) {
  const m = pickModel('gemini', model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
  };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${j?.error?.message || JSON.stringify(j)}`);
  const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  return { text, raw: j };
}

export async function callAi({ provider, model, apiKey, systemPrompt, userMessage }) {
  if (!apiKey) {
    const e = new Error('API key da IA não configurada (Parâmetros → IA)'); e.status = 400; throw e;
  }
  if (!userMessage) {
    const e = new Error('Mensagem para IA vazia'); e.status = 400; throw e;
  }
  const p = String(provider || 'anthropic').toLowerCase();
  switch (p) {
    case 'anthropic': return callAnthropic({ apiKey, model, systemPrompt, userMessage });
    case 'openai':    return callOpenAI({ apiKey, model, systemPrompt, userMessage });
    case 'gemini':    return callGemini({ apiKey, model, systemPrompt, userMessage });
    case 'groq':      return callGroq({ apiKey, model, systemPrompt, userMessage });
    default: {
      const e = new Error(`Provedor de IA inválido: ${p}`); e.status = 400; throw e;
    }
  }
}

// ── Visão (imagens/PDF) ──────────────────────────────────────────────
// files: [{ mime, b64 }]. Usado pra ler valor de comprovantes (imagem/PDF).
async function visionAnthropic({ apiKey, model, systemPrompt, userMessage, files }) {
  const content = [{ type: 'text', text: userMessage }];
  for (const f of files) {
    if (f.mime === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.b64 } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: f.mime || 'image/jpeg', data: f.b64 } });
    }
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: pickModel('anthropic', model), max_tokens: 1024, system: systemPrompt || undefined, messages: [{ role: 'user', content }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${j?.error?.message || JSON.stringify(j)}`);
  return { text: (j.content || []).map(c => c.text || '').join('').trim(), raw: j };
}

async function visionOpenAI({ apiKey, model, systemPrompt, userMessage, files }) {
  const parts = [{ type: 'text', text: userMessage }];
  for (const f of files) {
    // OpenAI chat vision aceita imagens (não PDF) via data URL
    if (f.mime !== 'application/pdf') parts.push({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.b64}` } });
  }
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: parts });
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: pickModel('openai', model), messages, temperature: 0.1 }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${j?.error?.message || JSON.stringify(j)}`);
  return { text: j?.choices?.[0]?.message?.content?.trim() || '', raw: j };
}

async function visionGemini({ apiKey, model, systemPrompt, userMessage, files }) {
  const m = pickModel('gemini', model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const parts = [{ text: userMessage }];
  for (const f of files) parts.push({ inlineData: { mimeType: f.mime, data: f.b64 } });
  const body = { contents: [{ role: 'user', parts }] };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${j?.error?.message || JSON.stringify(j)}`);
  return { text: (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim(), raw: j };
}

export async function callAiVision({ provider, model, apiKey, systemPrompt, userMessage, files }) {
  if (!apiKey) { const e = new Error('API key da IA não configurada'); e.status = 400; throw e; }
  if (!files?.length) { const e = new Error('Nenhum arquivo para a IA analisar'); e.status = 400; throw e; }
  const p = String(provider || 'anthropic').toLowerCase();
  if (p === 'anthropic') return visionAnthropic({ apiKey, model, systemPrompt, userMessage, files });
  if (p === 'openai')    return visionOpenAI({ apiKey, model, systemPrompt, userMessage, files });
  if (p === 'gemini')    return visionGemini({ apiKey, model, systemPrompt, userMessage, files });
  const e = new Error(`O provedor de IA "${p}" não suporta leitura de imagem. Informe o valor manualmente.`); e.status = 400; throw e;
}

// Tenta parsear bloco JSON da resposta (aceita ```json...``` ou objeto puro)
export function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).trim();
  // 1) tenta parse direto
  try { return JSON.parse(cleaned); } catch {}
  // 2) tenta extrair de bloco markdown
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  // 3) tenta achar o primeiro { ... } balanceado
  const first = cleaned.indexOf('{');
  const last  = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }
  return null;
}
