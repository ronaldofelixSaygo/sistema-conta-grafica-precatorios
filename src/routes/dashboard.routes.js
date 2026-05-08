import { Router } from 'express';
import * as ctrl from '../controllers/dashboard.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();
router.use(requireAuth);
router.get('/dashboard', ctrl.dashboard);
router.get('/saldos',    ctrl.saldos);
router.get('/alertas',   ctrl.alertas);
export default router;
