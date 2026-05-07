import { Router } from 'express';
import * as ctrl from '../controllers/partnerRequest.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();
router.use(requireAuth);
router.get ('/',     ctrl.list);
router.post('/',     ctrl.create);
router.get ('/:id',  ctrl.get);
router.put ('/:id',  ctrl.update);
export default router;
