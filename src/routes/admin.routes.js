import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/admin.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/role.middleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const router = Router();
router.use(requireAuth, requireAdmin);
router.post('/migrate-from-old', ctrl.migrateFromOld);
router.post('/wipe-movs',         ctrl.wipeMovs);
router.post('/seed-ncm',          ctrl.seedNcm);
router.post('/ncm-import', upload.single('file'), ctrl.importNcm);
export default router;
