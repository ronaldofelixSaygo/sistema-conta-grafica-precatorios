import { Router } from 'express';
import * as ctrl from '../controllers/chat.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();
router.use(requireAuth);
router.get ('/contacts',          ctrl.contacts);
router.get ('/conversations',     ctrl.conversations);
router.get ('/unread',            ctrl.unread);
router.get ('/messages/:otherId', ctrl.messages);
router.post('/messages/:otherId', ctrl.send);
export default router;
