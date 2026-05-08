import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/movimentacoes.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireStaff } from '../middlewares/role.middleware.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

const router = Router();
router.use(requireAuth);

router.get   ('/',     ctrl.list);
router.post  ('/',     requireStaff, ctrl.create);
router.put   ('/:id',  requireStaff, ctrl.update);
router.delete('/:id',  requireStaff, ctrl.remove);

// Importar Extrato PDF
router.post('/import-extrato/preview', requireStaff, upload.single('file'), ctrl.importExtratoPreview);
router.post('/import-extrato/apply',   requireStaff,                        ctrl.importExtratoApply);

export default router;
