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
router.get ('/scope-debug',       ctrl.scopeDebug);
router.post('/scope-fix',         ctrl.scopeFix);
router.get ('/storage-stats',     ctrl.storageStats);
router.get ('/email-debug',       ctrl.emailDebug);
router.post('/email-test-trigger', ctrl.emailTestTrigger);
export default router;
