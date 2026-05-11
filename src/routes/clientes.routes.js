import { Router } from 'express';
import * as ctrl from '../controllers/clientes.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireStaffOrPartnerEscritorio } from '../middlewares/role.middleware.js';

const router = Router();
router.use(requireAuth);

router.get   ('/export/excel',           ctrl.exportExcel);
router.get   ('/',                       ctrl.list);
router.get   ('/:id',                    ctrl.get);
router.post  ('/',                       requireStaffOrPartnerEscritorio, ctrl.create);
router.put   ('/comissao-lote',          requireStaffOrPartnerEscritorio, ctrl.bulkComissao);
router.put   ('/:id',                    requireStaffOrPartnerEscritorio, ctrl.update);
router.delete('/:id',                    requireStaffOrPartnerEscritorio, ctrl.remove);

export default router;
