import { lookupNcm } from '../services/ncm.service.js';

export async function lookup(req, res, next) {
  try {
    const { ncm } = req.params;
    const uf = req.query?.uf || null;
    const r = await lookupNcm(ncm, uf);
    res.json(r);
  } catch (e) { next(e); }
}
