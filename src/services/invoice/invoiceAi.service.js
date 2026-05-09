// =====================================================================
// Lê PDF de Invoice e usa IA configurada para extrair os campos
// necessários ao cálculo (formato JSON estruturado).
// =====================================================================
import { prisma } from '../../config/prisma.js';
import { callAi, extractJson } from './aiClient.service.js';

const DEFAULT_SYSTEM_PROMPT = `Você é um assistente especializado em ler invoices comerciais (commercial invoices) de importação para o Brasil e extrair dados estruturados.

Você receberá o TEXTO BRUTO extraído de um PDF de invoice. Sua tarefa é identificar e retornar os seguintes campos em JSON puro (sem markdown, sem explicações):

{
  "importadorNome": string,         // Nome do importador (Importer / Consignee)
  "importadorCnpj": string,         // CNPJ do importador
  "exportadorNome": string,         // Exportador (Shipper / Seller)
  "exportadorPais": string,         // País do exportador
  "ncm": string,                    // NCM principal (ou descrição da mercadoria)
  "uf": string,                     // UF de desembaraço (default "AL" se não claro)
  "vmle_usd": number,               // Valor FOB em USD (mercadoria)
  "frete_usd": number,              // Frete internacional em USD (0 se não houver)
  "seguro_usd": number,             // Seguro em USD (0 se não houver)
  "taxa_cambio": number,            // Taxa de câmbio R$/USD (use o valor do dia se o documento não trouxer; null se desconhecido)
  "ii_aliq": number,                // Alíquota II (%) — pode estimar pelo NCM se necessário
  "ipi_aliq": number,               // Alíquota IPI (%) — 0 se não tributado
  "pis_aliq": number,               // Alíquota PIS (%) — usar 2.1 se padrão
  "cofins_aliq": number,            // Alíquota Cofins (%) — usar 9.65 se padrão
  "icms_aliq_estado": number        // Alíquota ICMS do estado de desembaraço (%)
}

REGRAS:
- Retorne APENAS o JSON, sem markdown, sem texto antes ou depois.
- Se um campo não aparece no documento, use null (em vez de adivinhar).
- Para valores monetários, use ponto decimal (1234.56), nunca vírgula.
- Para alíquotas, retorne apenas o número (ex: 12 para 12%, não "12%").
- Confira que vmle_usd > 0; se zero, retorne null.`;

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

  // Converte chaves alternativas que a IA pode mandar
  const norm = {
    importadorNome: parsed.importadorNome ?? parsed.importador_nome ?? '',
    importadorCnpj: parsed.importadorCnpj ?? parsed.importador_cnpj ?? '',
    exportadorNome: parsed.exportadorNome ?? parsed.exportador_nome ?? '',
    exportadorPais: parsed.exportadorPais ?? parsed.exportador_pais ?? '',
    ncm: parsed.ncm ?? '',
    uf: parsed.uf ?? '',
    vmle_usd: parsed.vmle_usd ?? null,
    frete_usd: parsed.frete_usd ?? 0,
    seguro_usd: parsed.seguro_usd ?? 0,
    taxa_cambio: parsed.taxa_cambio ?? null,
    ii_aliq: parsed.ii_aliq ?? null,
    ipi_aliq: parsed.ipi_aliq ?? 0,
    pis_aliq: parsed.pis_aliq ?? 2.1,
    cofins_aliq: parsed.cofins_aliq ?? 9.65,
    icms_aliq_estado: parsed.icms_aliq_estado ?? null,
  };

  const promptVersion = await getActivePromptVersionNumber();
  return { fields: norm, raw: parsed, promptVersion };
}

export { DEFAULT_SYSTEM_PROMPT };
