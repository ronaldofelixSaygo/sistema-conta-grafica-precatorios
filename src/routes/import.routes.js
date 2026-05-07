import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireStaff } from '../middlewares/role.middleware.js';
import { importPlanilha } from '../controllers/import.controller.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
});

const router = Router();
router.post('/import', requireAuth, requireStaff, upload.single('file'), importPlanilha);
export default router;
