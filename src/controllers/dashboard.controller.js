import { getDashboard } from '../services/dashboard.service.js';
import { listSaldos } from '../services/saldos.service.js';
import { listComissoes } from '../services/comissoes.service.js';
import { listAlertas } from '../services/alertas.service.js';

export async function dashboard(req, res, next) {
  try { res.json(await getDashboard(req.user)); } catch (e) { next(e); }
}
export async function saldos(req, res, next) {
  try { res.json(await listSaldos(req.user)); } catch (e) { next(e); }
}
export async function comissoes(req, res, next) {
  try { res.json(await listComissoes(req.user, req.query)); } catch (e) { next(e); }
}
export async function alertas(req, res, next) {
  try { res.json(await listAlertas(req.user)); } catch (e) { next(e); }
}
