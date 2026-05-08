import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/movimentacoes.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireStaffOrPartnerEscritorio } from '../middlewares/role.middleware.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

const router = Router();
router.use(requireAuth);

router.get   ('/',     ctrl.list);
router.post  ('/',     requireStaffOrPartnerEscritorio, ctrl.create);
router.put   ('/:id',  requireStaffOrPartnerEscritorio, ctrl.update);
router.delete('/:id',  requireStaffOrPartnerEscritorio, ctrl.remove);

router.post('/import-extrato/preview', requireStaffOrPartnerEscritorio, upload.single('file'), ctrl.importExtratoPreview);
router.post('/import-extrato/apply',   requireStaffOrPartnerEscritorio,                        ctrl.importExtratoApply);

export default router;
