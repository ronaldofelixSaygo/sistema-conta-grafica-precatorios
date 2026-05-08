import { Router } from 'express';
import * as ctrl from '../controllers/email.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/role.middleware.js';

const router = Router();
router.use(requireAuth, requireAdmin);
router.get ('/settings',  ctrl.getSettings);
router.put ('/settings',  ctrl.updateSettings);
router.post('/test',      ctrl.testMail);
router.get ('/logs',      ctrl.listLogs);
export default router;
