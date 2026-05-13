import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024 } });

const router = Router();
router.post('/login',           ctrl.login);
router.post('/logout',          ctrl.logout);
router.get ('/me', requireAuth, ctrl.me);
router.post('/change-password', requireAuth, ctrl.changePassword);
router.post('/theme',           requireAuth, ctrl.setTheme);
// Avatar
router.post  ('/avatar',          requireAuth, upload.single('file'), ctrl.uploadAvatar);
router.delete('/avatar',          requireAuth, ctrl.deleteAvatar);
router.get   ('/avatar/:userId',  requireAuth, ctrl.getAvatar);
export default router;
