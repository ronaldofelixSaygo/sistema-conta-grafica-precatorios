import { Router } from 'express';
import * as ctrl from '../controllers/ncm.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();
router.use(requireAuth);
router.get('/:ncm', ctrl.lookup);
export default router;
