// =====================================================================
// Lê PDF de Invoice e usa IA configurada para extrair os campos
// necessários ao cálculo (formato JSON estruturado).
// =====================================================================
import { prisma } from '../../config/prisma.js';
import { callAi, callAiVision, extractJson } from './aiClient.service.js';

const DEFAULT_SYSTEM_PROMPT = `Você é um assistente especializado em ler invoices comerciais (commercial invoices) de importação para o Brasil e extrair dados estruturados.

Você receberá o TEXTO BRUTO extraído de um PDF de invoice. Sua tarefa é identificar TODOS os itens (linhas) da invoice e retornar um JSON puro (sem markdown, sem explicações) com a estrutura abaixo:

{
  "importadorNome": string | null,
  "importadorCnpj": string | null,
  "exportadorNome": string | null,
  "exportadorPais": string | null,
  "uf": string,                     // UF de desembaraço (default "AL")
  "taxa_cambio": number | null,     // R$/USD do dia (null se não constar)
  "frete_usd_total": number,        // frete internacional total em USD (0 se EXW/sem frete)
  "seguro_usd_total": number,       // seguro total em USD (0 se não houver)
  "items": [                        // ⚠ UMA ENTRADA POR LINHA da invoice
    {
      "ncm": string,                // NCM com pontuação (ex.: "8517.62.59")
      "descricao": string,          // descrição/nome do produto (Part No. + descrição)
      "quantidade": number,
      "unit_price_usd": number,     // preço unitário USD
      "extension_usd": number       // total da linha (qtd × unit_price)
    }
  ]
}

REGRAS:
- Liste TODAS as linhas de produto, mesmo que tenham o mesmo NCM. O sistema agrupa depois.
- Não some/agregue items aqui — devolva linha-a-linha como aparecem.
- Use ponto decimal (1234.56), nunca vírgula.
- Se um campo não aparece, use null (em vez de adivinhar).
- Não devolva alíquotas — o usuário preenche II/IPI/PIS/Cofins por NCM no formulário.
- Retorne APENAS o JSON, sem markdown, sem texto antes ou depois.`;

export async function getActivePromptText() {
  // 1) tenta versão ativa do prompt customizado
  const v = await prisma.aiPromptVersion.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  });
  if (v?.content) return v.content;

  // 2) se nunca foi configurado, retorna o default
  return DEFAULT_SYSTEM_PROMPT;
}

export async function getActivePromptVersionNumber() {
  const v = await prisma.aiPromptVersion.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'desc' },
  });
  return v?.version ?? null;
}

export async function getAiSettings() {
  const s = await prisma.aiSettings.findUnique({ where: { id: 'default' } });
  return s || null;
}

export async function saveAiSettings(data) {
  const payload = {
    provider: data.provider || 'anthropic',
    model:    data.model ?? null,
    apiKey:   data.apiKey ?? null,
    systemPrompt: data.systemPrompt ?? null,
    enabled:  !!data.enabled,
  };
  return prisma.aiSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...payload },
    update: payload,
  });
}

// Lista versões do prompt (admin)
export async function listPromptVersions() {
  return prisma.aiPromptVersion.findMany({
    orderBy: { version: 'desc' },
    include: { createdBy: { select: { id: true, name: true } } },
  });
}

// Cria nova versão e a torna ativa (desativando as outras)
export async function createPromptVersion(user, { content, notes }) {
  if (!content || !String(content).trim()) {
    const e = new Error('Conteúdo do prompt é obrigatório'); e.status = 400; throw e;
  }
  return prisma.$transaction(async (tx) => {
    await tx.aiPromptVersion.updateMany({ data: { active: false } });
    return tx.aiPromptVersion.create({
      data: {
        content: String(content),
        active: true,
        notes: notes || null,
        createdById: user?.id || null,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  });
}

// Reativa uma versão antiga
export async function activatePromptVersion(id) {
  return prisma.$transaction(async (tx) => {
    await tx.aiPromptVersion.updateMany({ data: { active: false } });
    return tx.aiPromptVersion.update({ where: { id }, data: { active: true } });
  });
}

// Lê o texto bruto de um PDF usando pdfjs-dist (já instalado)
export async function extractTextFromPdfBuffer(buffer) {
  // Carrega legacy ESM build (server-side)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(it => it.str).join(' ');
    out += text + '\n\n';
  }
  return out;
}

// Pipeline completo: PDF buffer → texto → IA → JSON estruturado
export async function analyzeInvoicePdf(buffer) {
  const settings = await getAiSettings();
  if (!settings || !settings.enabled) {
    const e = new Error('IA desabilitada. Configure em Parâmetros → IA.'); e.status = 400; throw e;
  }
  if (!settings.apiKey) {
    const e = new Error('API Key não configurada em Parâmetros → IA.'); e.status = 400; throw e;
  }

  const rawText = await extractTextFromPdfBuffer(buffer);
  if (!rawText || rawText.trim().length < 30) {
    const e = new Error('Não foi possível extrair texto deste PDF (talvez seja imagem)'); e.status = 422; throw e;
  }

  const systemPrompt = await getActivePromptText();
  const userMessage = `Texto extraído do PDF da invoice. Extraia os campos pedidos no formato JSON puro:\n\n---INÍCIO DO TEXTO---\n${rawText}\n---FIM DO TEXTO---`;

  const { text } = await callAi({
    provider: settings.provider,
    model: settings.model,
    apiKey: settings.apiKey,
    systemPrompt,
    userMessage,
  });

  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== 'object') {
    const e = new Error('IA respondeu em formato inesperado. Texto: ' + text.slice(0, 300)); e.status = 502; throw e;
  }

  // Suporta tanto o NOVO formato (com items[]) quanto o legado (campos flat)
  const items = Array.isArray(parsed.items) ? parsed.items : null;
  const cabecalho = {
    importadorNome: parsed.importadorNome ?? parsed.importador_nome ?? '',
    importadorCnpj: parsed.importadorCnpj ?? parsed.importador_cnpj ?? '',
    exportadorNome: parsed.exportadorNome ?? parsed.exportador_nome ?? '',
    exportadorPais: parsed.exportadorPais ?? parsed.exportador_pais ?? '',
    uf: parsed.uf ?? 'AL',
    taxa_cambio: parsed.taxa_cambio ?? null,
    frete_usd_total: Number(parsed.frete_usd_total ?? parsed.frete_usd ?? 0),
    seguro_usd_total: Number(parsed.seguro_usd_total ?? parsed.seguro_usd ?? 0),
  };

  // Agrupa items por NCM (canonicaliza removendo pontos pra comparar, mas guarda original)
  let ncmGroups = [];
  if (items) {
    const map = new Map();
    for (const it of items) {
      const ncm = String(it.ncm || '').trim();
      if (!ncm) continue;
      const key = ncm.replace(/\D/g, '');
      const cur = map.get(key) || { ncm, items: [], extension_usd_total: 0, quantidade_total: 0 };
      cur.items.push({
        descricao: it.descricao || '',
        quantidade: Number(it.quantidade) || 0,
        unit_price_usd: Number(it.unit_price_usd) || 0,
        extension_usd: Number(it.extension_usd) || 0,
      });
      cur.extension_usd_total += Number(it.extension_usd) || 0;
      cur.quantidade_total += Number(it.quantidade) || 0;
      map.set(key, cur);
    }
    ncmGroups = [...map.values()];
  } else if (parsed.ncm && (parsed.vmle_usd ?? 0) > 0) {
    // Legado: 1 NCM + valor total único
    ncmGroups = [{
      ncm: String(parsed.ncm),
      items: [{ descricao: '', quantidade: 1, unit_price_usd: Number(parsed.vmle_usd), extension_usd: Number(parsed.vmle_usd) }],
      extension_usd_total: Number(parsed.vmle_usd),
      quantidade_total: 1,
    }];
  }

  const promptVersion = await getActivePromptVersionNumber();
  return {
    fields: { ...cabecalho, ncmGroups, itemsRaw: items || [] },
    raw: parsed,
    promptVersion,
  };
}

// --- Extração por regex (offline) — cobre a maioria dos comprovantes com texto.
function _parseBrNumber(s) { return Number(String(s).replace(/\./g, '').replace(',', '.')); }
function _dmyToIso(dmy) { const m = String(dmy).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; }
function _cleanNome(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function _extractPagador(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  let m = s.match(/nome do pagador[:\s]+(.+?)\s+(?:cpf|cnpj|institui|ag[êe]ncia)/i);
  if (m) return _cleanNome(m[1]);
  m = s.match(/(?:quem est[áa] pagando|debitado)\b[:\s]*(?:nome\s+)?(.+?)\s+(?:cpf|cnpj|ag[êe]ncia|conta|tipo de conta)/i);
  if (m) return _cleanNome(m[1]);
  m = s.match(/\bcliente[:\s]+(.+?)\s+(?:ag[êe]ncia|agncia|conta|cpf|cnpj)/i);
  if (m) return _cleanNome(m[1]);
  return null;
}
export function extractReceiptFields(text) {
  const t = String(text || '').replace(/ /g, ' ');
  let valor = null;
  const vm = t.match(/valor[^\d]{0,60}?R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i)
          || t.match(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/)
          || t.match(/(\d{1,3}(?:\.\d{3})+,\d{2})/);
  if (vm) valor = _parseBrNumber(vm[1]);
  let data = null;
  const dm = t.match(/(?:data da transfer[êe]ncia|realizado em|efetuada em|emitido em|data\b)\D{0,20}?(\d{2}\/\d{2}\/\d{4})/i)
          || t.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (dm) data = _dmyToIso(dm[1]);
  return { valor: valor > 0 ? Math.round(valor * 100) / 100 : null, data, pagador: _extractPagador(t) };
}

// Normaliza uma data vinda da IA (aceita YYYY-MM-DD ou DD/MM/YYYY) → ISO ou null
function _normalizeAiDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return _dmyToIso(s);
  return null;
}

// Lê VALOR e DATA de um comprovante (best-effort). Ordem:
//  1) PDF com texto → regex (rápido, offline); se falhar, IA texto.
//  2) Imagem/PDF escaneado → IA com visão.
// Retorna { valor: number|null, data: 'YYYY-MM-DD'|null }. Cliente confirma depois.
export async function analyzeReceiptValue(buffer, mime) {
  const isPdf = (mime || '').includes('pdf');
  let text = '';
  if (isPdf) { try { text = await extractTextFromPdfBuffer(buffer); } catch {} }

  // 1) Tentativa offline por regex (PDF com texto)
  if (text && text.trim().length >= 20) {
    const viaRegex = extractReceiptFields(text);
    if (viaRegex.valor) return viaRegex;
  }

  // 2) IA (texto ou visão)
  const settings = await getAiSettings();
  if (!settings || !settings.enabled || !settings.apiKey) {
    // Sem IA e sem regex: devolve o que o regex conseguiu (pode ter pagador/data)
    return text ? extractReceiptFields(text) : { valor: null, data: null, pagador: null };
  }
  const sys = 'Você lê comprovantes de depósito/transferência bancária brasileiros (vários bancos/layouts) e extrai: o VALOR TOTAL, a DATA da transação e o NOME de quem está pagando (pagador/debitado, NÃO o favorecido/creditado). Responda APENAS um JSON puro: {"valor": number, "data": "YYYY-MM-DD", "pagador": string}. valor em reais com ponto decimal (ex.: 1234.56). Se não encontrar algum campo, use null.';
  const common = { provider: settings.provider, model: settings.model, apiKey: settings.apiKey, systemPrompt: sys };

  let out;
  try {
    if (text && text.trim().length >= 20) {
      out = await callAi({ ...common, userMessage: `Comprovante (texto):\n${text}` });
    } else {
      out = await callAiVision({ ...common, userMessage: 'Leia o comprovante em anexo e extraia valor, data e nome do pagador.', files: [{ mime: mime || 'image/jpeg', b64: buffer.toString('base64') }] });
    }
  } catch (e) {
    // IA falhou (ex.: provedor sem visão/modelo inválido) — cai no regex, se houver
    return text ? extractReceiptFields(text) : { valor: null, data: null, pagador: null };
  }

  const parsed = extractJson(out.text) || {};
  const valor = Number(parsed.valor);
  return {
    valor: Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : null,
    data: _normalizeAiDate(parsed.data),
    pagador: parsed.pagador ? _cleanNome(parsed.pagador) : (text ? _extractPagador(text) : null),
  };
}

// Extrai texto preservando o layout (linhas por coordenada Y, ordenadas por X).
// Necessário para tabelas/formulários (ex.: DMI) onde rótulo e valor precisam
// ficar na mesma linha — o extractTextFromPdfBuffer simples embaralha a ordem.
export async function extractPdfLayoutText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: false }).promise;
  let out = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = new Map();
    for (const it of content.items) {
      const x = it.transform[4], y = Math.round(it.transform[5]);
      let key = null;
      for (const k of lines.keys()) { if (Math.abs(k - y) <= 2) { key = k; break; } }
      if (key == null) { key = y; lines.set(key, []); }
      lines.get(key).push({ x, s: it.str });
    }
    const ys = [...lines.keys()].sort((a, b) => b - a);
    for (const y of ys) out += lines.get(y).sort((a, b) => a.x - b.x).map(o => o.s).join(' ') + '\n';
  }
  return out;
}

function _dmiFromText(text) {
  const t = String(text || '').replace(/[ \t]+/g, ' ');
  const m = t.match(/ICMS\s*Comp[^\d\n]{0,40}?(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  return m ? _parseBrNumber(m[1]) : null;
}

// Lê o valor de "ICMS Comp. C/Gráfica" (ICMS a desonerar) de uma DMI.
// PDF com texto → layout + regex (offline); senão IA (texto/visão). null se não achar.
export async function analyzeDmiIcms(buffer, mime) {
  const isPdf = (mime || '').includes('pdf');
  if (isPdf) {
    try { const v = _dmiFromText(await extractPdfLayoutText(buffer)); if (v) return v; } catch {}
  }
  const settings = await getAiSettings();
  if (!settings || !settings.enabled || !settings.apiKey) return null;
  const sys = 'Você lê uma DMI (desoneração de ICMS) e extrai o valor do campo "ICMS Comp. C/Gráfica" (ICMS a compensar na conta gráfica). Responda APENAS JSON {"valor": number} em reais com ponto decimal. Se não achar, {"valor": null}.';
  const common = { provider: settings.provider, model: settings.model, apiKey: settings.apiKey, systemPrompt: sys };
  try {
    let text = '';
    if (isPdf) { try { text = await extractTextFromPdfBuffer(buffer); } catch {} }
    const out = (text && text.trim().length >= 20)
      ? await callAi({ ...common, userMessage: `DMI (texto):\n${text}` })
      : await callAiVision({ ...common, userMessage: 'Leia a DMI e extraia o valor de "ICMS Comp. C/Gráfica".', files: [{ mime: mime || 'application/pdf', b64: buffer.toString('base64') }] });
    const v = Number((extractJson(out.text) || {}).valor);
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
  } catch { return null; }
}

export { DEFAULT_SYSTEM_PROMPT };
