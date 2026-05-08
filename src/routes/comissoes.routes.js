import { Router } from 'express';
import * as ctrl from '../controllers/comissoes.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();
router.use(requireAuth);
// dropdown de escritórios (distinct cliente.escritorio dentro do escopo do user)
router.get ('/escritorios',             ctrl.listEscritorios);
// simulacao on-the-fly (todos podem ver — escopo aplicado dentro do service)
router.get ('/simulate',                ctrl.simulate);
// crud da apuracao persistida
router.get ('/',                        ctrl.listCommissions);
router.post('/',                        ctrl.generate);
router.post('/:id/submit',              ctrl.submit);
router.post('/:id/approve',             ctrl.approve);
router.post('/:id/reject',              ctrl.reject);
router.post('/:id/close',               ctrl.close);
router.post('/:id/extras',              ctrl.addExtra);
router.delete('/extras/:extraId',       ctrl.removeExtra);
export default router;
