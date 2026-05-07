import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();
router.post('/login',           ctrl.login);
router.post('/logout',          ctrl.logout);
router.get ('/me', requireAuth, ctrl.me);
router.post('/change-password', requireAuth, ctrl.changePassword);
export default router;
