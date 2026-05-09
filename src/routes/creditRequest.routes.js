import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/creditRequest.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/role.middleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const router = Router();
router.use(requireAuth);

// AI Settings — somente ADM
router.get('/ai/settings',                 requireAdmin, ctrl.getSettings);
router.put('/ai/settings',                 requireAdmin, ctrl.saveSettings);
router.get('/ai/prompt/versions',          requireAdmin, ctrl.listPromptVersions);
router.get('/ai/prompt/active',            ctrl.getActivePrompt); // qualquer logado pode ver
router.post('/ai/prompt',                  requireAdmin, ctrl.newPromptVersion);
router.post('/ai/prompt/:id/activate',     requireAdmin, ctrl.activatePrompt);

// Análise IA + simulação
router.post('/analyze-pdf', upload.single('file'),       ctrl.analyzePdf);
router.post('/simulate',                                 ctrl.simulate);

// Credit requests
router.get('/',                                          ctrl.list);
router.post('/', upload.single('file'),                  ctrl.create);
router.get('/:id',                                       ctrl.get);
router.post('/:id/send',                                 ctrl.send);
router.post('/:id/start',                                ctrl.start);
router.post('/:id/resolve', upload.single('file'),       ctrl.resolve);
router.post('/:id/cancel',                               ctrl.cancel);
router.get('/:id/pdf',                                   ctrl.downloadPdf);
router.get('/:id/evidence',                              ctrl.downloadEvidence);

export default router;
