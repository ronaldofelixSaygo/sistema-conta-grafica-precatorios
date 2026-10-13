// =====================================================================
// Lê PDF de Invoice e usa IA configurada para extrair os campos
// necessários ao cálculo (formato JSON estruturado).
// =====================================================================
import { prisma } from '../../config/prisma.js';
import { callAi, callAiVision, extractJson } from './aiClient.service.js';

const DEFAULT_SYSTEM_PROMPT = `Você é um especialista em comércio exterior brasileiro e lê invoices comerciais (commercial invoices, proformas e cotações FOB/CIF) de importação para extrair dados estruturados para o cálculo de créditos de ICMS.

Você receberá o TEXTO extraído de um PDF (linhas preservadas na ordem do layout) ou o próprio documento (imagem/PDF). Retorne APENAS um JSON puro (sem markdown, sem texto antes ou depois) com esta estrutura:

{
  "invoiceNumero": string | null,     // nº da invoice/proforma (ex.: "HC20260416001")
  "invoiceData": "YYYY-MM-DD" | null, // data de emissão
  "incoterm": string | null,          // FOB, CIF, CFR, EXW, FCA, DAP...
  "localIncoterm": string | null,     // porto/local do incoterm (ex.: "Tianjin")
  "moeda": string,                    // moeda dos valores (default "USD")
  "importadorNome": string | null,    // BUYER / CONSIGNEE / IMPORTER (a empresa brasileira)
  "importadorCnpj": string | null,    // CNPJ do importador no formato 00.000.000/0000-00
  "exportadorNome": string | null,    // SELLER / SHIPPER / EXPORTER
  "exportadorPais": string | null,    // país do exportador, em português (ex.: "China")
  "uf": string,                       // UF do importador/desembaraço (sigla; default "AL")
  "taxa_cambio": number | null,       // R$/USD SOMENTE se estiver escrita no documento; senão null
  "frete_usd_total": number,          // frete internacional em USD
  "seguro_usd_total": number,         // seguro internacional em USD
  "total_invoice_usd": number | null, // valor TOTAL da invoice como impresso
  "items": [                          // UMA entrada por LINHA de produto
    {
      "ncm": string | null,           // NCM/HS IMPRESSO no documento (ex.: "7306.30.00"); null se não houver
      "ncm_sugerido": string | null,  // quando "ncm" for null: sua melhor classificação NCM (8 dígitos, "0000.00.00")
      "ncm_justificativa": string | null, // 1 frase: por que esse NCM
      "descricao": string,            // nome do produto + especificação (ex.: "Q195 Steel Pipe 19mm x 0.22mm x 5500mm")
      "quantidade": number,           // quantidade NA MESMA UNIDADE do preço unitário
      "unidade": string | null,       // unidade do preço: "KG", "PCS", "M", "TON", "SET"...
      "unit_price_usd": number,       // preço unitário
      "extension_usd": number,        // TOTAL DA LINHA exatamente como impresso
      "peso_liquido_kg": number | null
    }
  ]
}

REGRAS IMPORTANTES:
1. Itens: liste TODAS as linhas de produto, sem agregar. Ignore linhas de subtotal/total, dados bancários, fotos, condições de pagamento e observações.
2. Quantidade x unidade: use a quantidade na unidade em que o preço é cobrado. Ex.: colunas "Total quantity (pieces)=16000", "Total Qty (Kgs)=8960", "FOB (Usd/kg)=0.844", "Total Value=7562.24" → quantidade=8960, unidade="KG", unit_price_usd=0.844, extension_usd=7562.24. Confira: quantidade × unit_price_usd ≈ extension_usd.
3. extension_usd é sempre o valor total da linha impresso; nunca invente. Se a linha não tiver total, calcule quantidade × preço unitário.
4. NCM: se o documento trouxer NCM/HS code, copie-o em "ncm" (formato 0000.00.00; HS de 6 dígitos → complete com "00" e repita em ncm_sugerido). Se NÃO trouxer, deixe "ncm": null e SEMPRE preencha "ncm_sugerido" com o NCM brasileiro (TEC/Mercosul) mais provável pela descrição, material e especificação técnica. Ex.: tubos de aço carbono soldados, seção circular, diâmetro pequeno → "7306.30.00"; tubos sem costura de ferro/aço → 7304; parafusos de aço → 7318.15.00.
5. Frete e seguro: FOB, FCA, EXW → frete_usd_total=0 e seguro_usd_total=0, salvo se o documento listar frete/seguro separadamente. CFR/CIF → use os valores de frete/seguro informados; se não estiverem discriminados, 0.
6. Números: ponto decimal (1234.56), sem separador de milhar, sem símbolo de moeda. "$15,800" → 15800.
7. CNPJ: normalize para 00.000.000/0000-00 (ex.: "61331341/000215" → "61.331.341/0002-15").
8. Se um campo não aparece, use null — não adivinhe (exceto ncm_sugerido, que deve ser sempre preenchido quando ncm for null).
9. Não devolva alíquotas de impostos.`;

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

// ── Helpers da leitura de invoice ─────────────────────────────────────
function _num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  // "1.234,56" (BR) → 1234.56 ; "1,234.56" (US) → 1234.56 ; "15,800" → 15800
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const _r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Normaliza NCM pra "0000.00.00". Aceita HS de 6 dígitos (completa com 00).
function _fmtNcm(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 6) d += '00';
  if (d.length !== 8) return null;
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
}

function _fmtCnpj(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 14) return v ? String(v).trim() : '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// Cotação PTAX (venda) mais recente do Banco Central. null se indisponível.
export async function fetchPtaxUsd() {
  const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
  const fim = new Date();
  const ini = new Date(fim.getTime() - 10 * 86400000);
  const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${fmt(ini)}'&@dataFinalCotacao='${fmt(fim)}'&$format=json&$top=100`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const last = (j.value || []).at(-1);
    if (!last?.cotacaoVenda) return null;
    return { taxa: Number(last.cotacaoVenda), data: String(last.dataHoraCotacao).slice(0, 10) };
  } catch { return null; }
}

// Bloco anexado a prompts customizados antigos (cadastrados em Parâmetros → IA)
// que ainda não conhecem os campos novos — garante que itens sem NCM não se percam.
const PROMPT_COMPLEMENTO = `

REGRAS COMPLEMENTARES (sistema):
- Para cada item, se a invoice NÃO trouxer NCM/HS, use "ncm": null e preencha "ncm_sugerido" com o NCM brasileiro mais provável (8 dígitos, "0000.00.00") e "ncm_justificativa" com 1 frase.
- "quantidade" deve estar na mesma unidade do preço unitário (ex.: kg quando o preço é USD/kg) e "extension_usd" é o total da linha impresso.
- Inclua também "invoiceNumero", "invoiceData" (YYYY-MM-DD), "incoterm" e "total_invoice_usd" (total impresso).`;

// Pipeline completo: PDF buffer → texto → IA → JSON estruturado
export async function analyzeInvoicePdf(buffer) {
  const settings = await getAiSettings();
  if (!settings || !settings.enabled) {
    const e = new Error('IA desabilitada. Configure em Parâmetros → IA.'); e.status = 400; throw e;
  }
  if (!settings.apiKey) {
    const e = new Error('API Key não configurada em Parâmetros → IA.'); e.status = 400; throw e;
  }

  // Texto com layout (linhas por coordenada) preserva as colunas das tabelas;
  // o texto "plano" embaralha a ordem e confunde qtd/preço/total.
  let rawText = '';
  try { rawText = await extractPdfLayoutText(buffer); } catch {}
  if (!rawText || rawText.trim().length < 30) {
    try { rawText = await extractTextFromPdfBuffer(buffer); } catch {}
  }

  let systemPrompt = await getActivePromptText();
  if (!/ncm_sugerido/.test(systemPrompt)) systemPrompt += PROMPT_COMPLEMENTO;
  const common = { provider: settings.provider, model: settings.model, apiKey: settings.apiKey, systemPrompt };

  let text;
  if (rawText && rawText.trim().length >= 30) {
    const userMessage = `Texto extraído do PDF da invoice (uma linha do documento por linha). Extraia os campos pedidos no formato JSON puro:\n\n---INÍCIO DO TEXTO---\n${rawText}\n---FIM DO TEXTO---`;
    ({ text } = await callAi({ ...common, userMessage }));
  } else {
    // PDF sem texto (imagem/escaneado) → leitura por VISÃO.
    try {
      ({ text } = await callAiVision({
        ...common,
        userMessage: 'Esta é uma invoice comercial (imagem/PDF escaneado). Leia o documento e extraia os campos pedidos no formato JSON puro.',
        files: [{ mime: 'application/pdf', b64: buffer.toString('base64') }],
      }));
    } catch (e) {
      const err = new Error('Este PDF é uma imagem (sem texto). A leitura por visão falhou — verifique em Parâmetros → IA se o provedor/modelo tem suporte a visão (ex.: Anthropic Claude ou Gemini). Detalhe: ' + (e.message || ''));
      err.status = 422; throw err;
    }
  }

  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== 'object') {
    const e = new Error('IA respondeu em formato inesperado. Texto: ' + String(text || '').slice(0, 300)); e.status = 502; throw e;
  }
  return postProcessInvoice(parsed, common);
}

// Quando o NCM sugerido não existe na tabela TEC do sistema (ex.: IA sugeriu
// "7306.30.00" mas a TEC tem 7306.30.10 / 7306.30.90), busca os NCMs válidos
// da mesma posição e pede pra IA escolher o correto entre eles.
async function _refineNcmPelaTec(sugerido, descricoes, aiCommon) {
  const d = String(sugerido || '').replace(/\D/g, '');
  if (d.length !== 8 || !aiCommon) return null;
  let cands = [];
  for (const len of [6, 4]) {
    try {
      cands = await prisma.ncmTributo.findMany({
        where: { ncm: { startsWith: d.slice(0, len) } },
        select: { ncm: true, descricao: true }, orderBy: { ncm: 'asc' }, take: 80,
      });
    } catch { return null; }
    if (cands.some(c => c.ncm.length === 8)) break;
  }
  const finais = cands.filter(c => c.ncm.length === 8);
  if (!finais.length) return null;
  if (finais.length === 1) return finais[0].ncm;
  // Descrição hierárquica (posição > subposição > item) pra IA entender o contexto
  const pais = new Map(cands.filter(c => c.ncm.length < 8).map(c => [c.ncm, c.descricao]));
  const linhas = finais.map(c => {
    const ctx = [c.ncm.slice(0, 4), c.ncm.slice(0, 5), c.ncm.slice(0, 6), c.ncm.slice(0, 7)]
      .map(k => pais.get(k)).filter(Boolean).join(' > ');
    return `${c.ncm}: ${ctx ? ctx + ' > ' : ''}${c.descricao || ''}`;
  }).join('\n');
  try {
    const { text } = await callAi({
      ...aiCommon,
      systemPrompt: 'Você é especialista em classificação fiscal (NCM/TEC Mercosul). Escolha, ENTRE AS OPÇÕES DADAS, o NCM que melhor classifica o produto. Responda APENAS JSON {"ncm": "00000000", "justificativa": "1 frase"}.',
      userMessage: `Produto(s):\n${descricoes.map(x => '- ' + x).join('\n')}\n\nOpções válidas na TEC:\n${linhas}`,
    });
    const j = extractJson(text) || {};
    const esc = String(j.ncm || '').replace(/\D/g, '');
    const ok = finais.find(c => c.ncm === esc);
    return ok ? { ncm: ok.ncm, justificativa: j.justificativa || null } : null;
  } catch { return null; }
}

// Normaliza a resposta da IA, completa NCM (impresso → sugerido), confere
// totais e busca PTAX quando a invoice não traz câmbio. Exportada p/ testes.
export async function postProcessInvoice(parsed, aiCommon = null) {
  const avisos = [];
  const items = Array.isArray(parsed.items) ? parsed.items : null;

  let taxa = _num(parsed.taxa_cambio);
  let taxaFonte = taxa ? 'invoice' : null;
  if (!taxa) {
    const ptax = await fetchPtaxUsd();
    if (ptax) {
      taxa = ptax.taxa; taxaFonte = 'ptax';
      avisos.push(`Taxa de câmbio não consta na invoice — preenchida com a PTAX venda do Banco Central de ${ptax.data.split('-').reverse().join('/')} (R$ ${ptax.taxa.toFixed(4)}). Ajuste se necessário.`);
    } else {
      avisos.push('Taxa de câmbio não consta na invoice — informe manualmente.');
    }
  }

  const incMatch = String(parsed.incoterm || '').toUpperCase().match(/\b(EXW|FCA|FAS|FOB|CFR|CNF|C&F|CIF|CPT|CIP|DAP|DPU|DAT|DDP)\b/);
  const incoterm = incMatch ? incMatch[1].replace('CNF', 'CFR').replace('C&F', 'CFR') : (parsed.incoterm ? String(parsed.incoterm).toUpperCase().trim() : null);
  let frete = _num(parsed.frete_usd_total ?? parsed.frete_usd) || 0;
  let seguro = _num(parsed.seguro_usd_total ?? parsed.seguro_usd) || 0;
  if (incoterm && ['FOB', 'FCA', 'EXW', 'FAS'].includes(incoterm) && frete === 0) {
    avisos.push(`Invoice ${incoterm}: frete e seguro internacionais não estão inclusos — informe-os em cada NCM se já forem conhecidos.`);
  }

  const cabecalho = {
    importadorNome: parsed.importadorNome ?? parsed.importador_nome ?? '',
    importadorCnpj: _fmtCnpj(parsed.importadorCnpj ?? parsed.importador_cnpj ?? ''),
    exportadorNome: parsed.exportadorNome ?? parsed.exportador_nome ?? '',
    exportadorPais: parsed.exportadorPais ?? parsed.exportador_pais ?? '',
    uf: (parsed.uf && String(parsed.uf).trim().toUpperCase().slice(0, 2)) || 'AL',
    taxa_cambio: taxa ? Number(taxa.toFixed(4)) : null,
    taxa_cambio_fonte: taxaFonte,
    frete_usd_total: frete,
    seguro_usd_total: seguro,
    invoiceNumero: parsed.invoiceNumero ?? null,
    invoiceData: _normalizeAiDate(parsed.invoiceData),
    incoterm,
    total_invoice_usd: _num(parsed.total_invoice_usd),
  };

  // Normaliza itens
  const norm = [];
  for (const it of items || []) {
    const qtd = _num(it.quantidade) || 0;
    const unit = _num(it.unit_price_usd) || 0;
    let ext = _num(it.extension_usd);
    if (!ext && qtd && unit) ext = qtd * unit;
    ext = _r2(ext);
    if (!ext && !it.descricao) continue;
    const impresso = _fmtNcm(it.ncm);
    const sugerido = _fmtNcm(it.ncm_sugerido);
    norm.push({
      ncm: impresso || sugerido || '',
      ncm_origem: impresso ? 'invoice' : (sugerido ? 'sugerido_ia' : null),
      ncm_justificativa: it.ncm_justificativa || null,
      descricao: it.descricao || '',
      quantidade: qtd,
      unidade: it.unidade || null,
      unit_price_usd: unit,
      extension_usd: ext,
    });
  }

  // Confere se os NCMs existem na tabela TEC do sistema
  const ncmDigits = [...new Set(norm.map(i => i.ncm.replace(/\D/g, '')).filter(Boolean))];
  let existentes = null;
  if (ncmDigits.length) {
    try {
      const rows = await prisma.ncmTributo.findMany({ where: { ncm: { in: ncmDigits } }, select: { ncm: true } });
      existentes = new Set(rows.map(r => r.ncm));
    } catch {}
  }

  // NCM sugerido pela IA que não existe na TEC → refina entre os NCMs válidos
  if (existentes) {
    const refinados = new Map();
    for (const it of norm) {
      const k = it.ncm.replace(/\D/g, '');
      if (it.ncm_origem !== 'sugerido_ia' || !k || existentes.has(k)) continue;
      if (!refinados.has(k)) {
        const descs = norm.filter(x => x.ncm === it.ncm).map(x => x.descricao).slice(0, 10);
        refinados.set(k, await _refineNcmPelaTec(it.ncm, descs, aiCommon));
      }
      const r = refinados.get(k);
      if (r) {
        const nk = typeof r === 'string' ? r : r.ncm;
        it.ncm = _fmtNcm(nk);
        if (r.justificativa) it.ncm_justificativa = r.justificativa;
        existentes.add(nk);
      }
    }
  }

  // Agrupa por NCM (itens sem NCM ficam num grupo vazio pra não perder valor)
  const map = new Map();
  for (const it of norm) {
    const key = it.ncm.replace(/\D/g, '') || '__SEM_NCM__';
    const cur = map.get(key) || {
      ncm: it.ncm, ncm_origem: it.ncm_origem, ncm_justificativa: it.ncm_justificativa,
      ncm_cadastrado: existentes ? existentes.has(key) : null,
      items: [], extension_usd_total: 0, quantidade_total: 0,
    };
    cur.items.push({ descricao: it.descricao, quantidade: it.quantidade, unidade: it.unidade, unit_price_usd: it.unit_price_usd, extension_usd: it.extension_usd });
    cur.extension_usd_total = _r2(cur.extension_usd_total + it.extension_usd);
    cur.quantidade_total += it.quantidade;
    map.set(key, cur);
  }
  let ncmGroups = [...map.values()];

  // Legado: 1 NCM + valor total único
  if (!items && parsed.ncm && (_num(parsed.vmle_usd) ?? 0) > 0) {
    ncmGroups = [{ ncm: _fmtNcm(parsed.ncm) || String(parsed.ncm), ncm_origem: 'invoice',
      items: [{ descricao: '', quantidade: 1, unit_price_usd: _num(parsed.vmle_usd), extension_usd: _num(parsed.vmle_usd) }],
      extension_usd_total: _num(parsed.vmle_usd), quantidade_total: 1 }];
  }

  for (const g of ncmGroups) {
    if (!g.ncm) avisos.push(`${g.items.length} item(ns) sem NCM (US$ ${g.extension_usd_total.toFixed(2)}) — informe o NCM manualmente.`);
    else if (g.ncm_origem === 'sugerido_ia') avisos.push(`NCM ${g.ncm} SUGERIDO pela IA (a invoice não informa NCM)${g.ncm_justificativa ? ': ' + g.ncm_justificativa : ''} — confirme antes de enviar.`);
    if (g.ncm && g.ncm_cadastrado === false) avisos.push(`NCM ${g.ncm} não encontrado na tabela TEC do sistema — verifique.`);
  }

  // Confere soma das linhas x total impresso
  const soma = _r2(norm.reduce((s, i) => s + i.extension_usd, 0));
  if (cabecalho.total_invoice_usd && soma && Math.abs(soma - cabecalho.total_invoice_usd) > Math.max(1, cabecalho.total_invoice_usd * 0.005)) {
    avisos.push(`Soma dos itens (US$ ${soma.toFixed(2)}) difere do total da invoice (US$ ${cabecalho.total_invoice_usd.toFixed(2)}) — confira os valores.`);
  }
  if (!norm.length) avisos.push('Nenhum item de produto foi identificado na invoice.');

  const promptVersion = await getActivePromptVersionNumber();
  return {
    fields: { ...cabecalho, soma_itens_usd: soma, ncmGroups, itemsRaw: items || [], avisos },
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
