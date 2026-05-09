// =====================================================================
// Lê PDF de Invoice e usa IA configurada para extrair os campos
// necessários ao cálculo (formato JSON estruturado).
// =====================================================================
import { prisma } from '../../config/prisma.js';
import { callAi, extractJson } from './aiClient.service.js';

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

export { DEFAULT_SYSTEM_PROMPT };
