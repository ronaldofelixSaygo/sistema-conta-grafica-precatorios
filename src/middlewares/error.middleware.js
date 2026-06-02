// Handler central de erros para /api/*
//
// Converte erros técnicos do Prisma em mensagens amigáveis em pt-BR e
// esconde detalhes internos do banco do usuário final. Em desenvolvimento
// ainda inclui stack/detalhes pra debug.

const FIELD_LABELS = {
  email:     'e-mail',
  cnpj:      'CNPJ',
  cnpjFilial:'CNPJ filial',
  nome:      'nome',
  code:      'código',
  monthRef:  'mês de referência',
  module:    'módulo',
  clienteId: 'cliente vinculado',
  parceiroId:'parceiro vinculado',
};

// Tenta extrair os campos da mensagem do Prisma. Ex.:
// "Unique constraint failed on the fields: (`email`)" → ['email']
function extractFieldsFromPrismaMsg(msg) {
  const m = /fields?: \(?[`"]?([^`"\)]+)[`"]?\)?/i.exec(msg || '');
  if (!m) return [];
  return m[1].split(',').map(s => s.trim().replace(/[`"]/g, ''));
}

function friendlyField(name) {
  return FIELD_LABELS[name] || name;
}

function mapPrismaError(err) {
  const code = err?.code;
  if (!code || typeof code !== 'string' || !code.startsWith('P')) return null;
  const fields = extractFieldsFromPrismaMsg(err.message);
  const fLabel = fields.map(friendlyField).join(', ');

  switch (code) {
    // Unique constraint
    case 'P2002': return {
      status: 409,
      message: fLabel
        ? `Já existe registro com esse ${fLabel}.`
        : 'Esse registro já existe (valor duplicado).',
    };
    // Foreign key
    case 'P2003': return {
      status: 400,
      message: 'Referência inválida — verifique se os registros vinculados existem.',
    };
    // Required field missing
    case 'P2011': return {
      status: 400,
      message: fLabel ? `Campo obrigatório não preenchido: ${fLabel}.` : 'Campo obrigatório não preenchido.',
    };
    // Field doesn't exist
    case 'P2009':
    case 'P2012': return { status: 400, message: 'Dados inválidos enviados.' };
    // Not found
    case 'P2025': return { status: 404, message: 'Registro não encontrado.' };
    // Connection / timeout
    case 'P1001':
    case 'P1002':
    case 'P1008': return { status: 503, message: 'Banco de dados temporariamente indisponível. Tente novamente em instantes.' };
    default: return null;
  }
}

export function apiErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  // Logging completo no servidor (preserva tudo pra debug)
  console.error('[API error]', err);

  // 1) Erros do Prisma → mensagem amigável
  const prismaMapped = mapPrismaError(err);
  if (prismaMapped) {
    return res.status(prismaMapped.status).json({ error: prismaMapped.message });
  }

  // 2) Erros já com status definido (manualmente lançados nos services)
  const status = err.status || 500;
  // Em produção, NÃO expor mensagens nem stack pra erros 500 não mapeados —
  // pode vazar SQL, paths, etc. Em dev, mostra tudo pra facilitar debug.
  const isProd = process.env.NODE_ENV === 'production';
  if (status >= 500 && isProd) {
    return res.status(status).json({ error: 'Erro interno do servidor' });
  }
  res.status(status).json({
    error: err.message || 'Erro interno do servidor',
    ...(isProd ? {} : { stack: err.stack }),
  });
}

export function notFoundApi(req, res) {
  res.status(404).json({ error: 'Rota não encontrada', path: req.originalUrl });
}
