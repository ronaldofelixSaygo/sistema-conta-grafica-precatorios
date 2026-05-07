import { Router } from 'express';
import * as ctrl from '../controllers/users.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/role.middleware.js';

const router = Router();
router.use(requireAuth, requireAdmin);
router.get   ('/',     ctrl.list);
router.post  ('/',     ctrl.create);
router.put   ('/:id',  ctrl.update);
router.post  ('/:id/deactivate', ctrl.deactivate);
router.delete('/:id',  ctrl.remove);
export default router;
