import { Router } from 'express';
import * as ctrl from '../controllers/clientes.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireStaff } from '../middlewares/role.middleware.js';

const router = Router();
router.use(requireAuth);

router.get   ('/',                       ctrl.list);
router.get   ('/:id',                    ctrl.get);
router.post  ('/',                       requireStaff, ctrl.create);
router.put   ('/comissao-lote',          requireStaff, ctrl.bulkComissao);
router.put   ('/:id',                    requireStaff, ctrl.update);
router.delete('/:id',                    requireStaff, ctrl.remove);

export default router;
