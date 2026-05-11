import { Router } from 'express';
import * as ctrl from '../controllers/partnerKind.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/role.middleware.js';

const router = Router();
router.use(requireAuth);

// Lista ativos — qualquer logado pode consultar (pra popular dropdowns)
router.get('/active', ctrl.listActive);

// CRUD completo — só admin
router.get   ('/',    requireAdmin, ctrl.list);
router.post  ('/',    requireAdmin, ctrl.create);
router.put   ('/:id', requireAdmin, ctrl.update);
router.delete('/:id', requireAdmin, ctrl.remove);

export default router;
