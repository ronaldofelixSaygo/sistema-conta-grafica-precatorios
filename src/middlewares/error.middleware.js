// Handler central de erros para /api/*
export function apiErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  console.error('[API error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Erro interno do servidor',
    ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  });
}

export function notFoundApi(req, res) {
  res.status(404).json({ error: 'Rota não encontrada', path: req.originalUrl });
}
