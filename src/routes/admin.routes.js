import { Router } from 'express';
import * as ctrl from '../controllers/admin.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/role.middleware.js';

const router = Router();
router.use(requireAuth, requireAdmin);
router.post('/migrate-from-old', ctrl.migrateFromOld);
export default router;
