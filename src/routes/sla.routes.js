import { Router } from 'express';
import * as ctrl from '../controllers/sla.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/role.middleware.js';

const router = Router();
router.use(requireAuth, requireAdmin);

// Expediente (singleton)
router.get('/config', ctrl.getConfig);
router.put('/config', ctrl.updateConfig);

// Feriados
router.get('/feriados', ctrl.listFeriados);
router.post('/feriados', ctrl.createFeriado);
router.delete('/feriados/:id', ctrl.deleteFeriado);

export default router;
