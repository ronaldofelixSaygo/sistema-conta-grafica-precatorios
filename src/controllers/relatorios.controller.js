import * as rel from '../services/relatorios.service.js';

export async function relatorioJson(req, res, next) {
  try { res.json(await rel.relatorioJson(req.user, req.query)); } catch (e) { next(e); }
}
export async function relatorioExcel(req, res, next) {
  try { await rel.relatorioExcel(req.user, req.query, res); } catch (e) { next(e); }
}
export async function relatorioPdf(req, res, next) {
  try { await rel.relatorioPdf(req.user, req.query, res); } catch (e) { next(e); }
}
