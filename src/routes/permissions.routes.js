import { Router } from 'express';
import * as ctrl from '../controllers/permissions.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/role.middleware.js';

const router = Router();
router.use(requireAuth, requireAdmin);
router.get('/',         ctrl.list);
router.put('/:id',      ctrl.update);
router.post('/reset',   ctrl.reset);
export default router;
