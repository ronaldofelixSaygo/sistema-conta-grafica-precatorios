import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/kanban.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireStaff } from '../middlewares/role.middleware.js';
import { MAX_UPLOAD_BYTES } from '../utils/kanban.constants.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const router = Router();
router.use(requireAuth);

router.get ('/meta',                ctrl.meta);
router.get ('/stage-configs',                  ctrl.listStageConfigs);
router.put ('/stage-configs/:stage', requireStaff, ctrl.updateStageConfig);
router.get ('/cards',               ctrl.listCards);
router.post('/cards', requireStaff, ctrl.createCard);
router.get ('/cards/:id',           ctrl.getCard);
router.put ('/cards/:id/stages/:stage',          ctrl.updateStage);
router.post('/cards/:id/stages/:stage/complete', ctrl.completeStage);
router.post('/cards/:id/move',     requireStaff, ctrl.moveCard);

router.post  ('/cards/:id/attachments', upload.single('file'), ctrl.uploadAttachment);
router.get   ('/attachments/:attId',                          ctrl.downloadAttachment);
router.delete('/attachments/:attId',                          ctrl.deleteAttachment);

export default router;
