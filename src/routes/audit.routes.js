import { Router } from 'express';
import * as ctrl from '../controllers/audit.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/role.middleware.js';

const router = Router();
router.use(requireAuth, requireAdmin);
router.get('/', ctrl.list);
export default router;
