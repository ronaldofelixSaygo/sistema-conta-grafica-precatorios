import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/creditRequest.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/role.middleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const router = Router();
router.use(requireAuth);

// SLA Config — leitura aberta a logados, escrita só admin
router.get('/sla-config',                 ctrl.getSlaConfig);
router.put('/sla-config',                 requireAdmin, ctrl.saveSlaConfig);

// AI Settings — somente ADM
router.get('/ai/settings',                 requireAdmin, ctrl.getSettings);
router.put('/ai/settings',                 requireAdmin, ctrl.saveSettings);
router.get('/ai/prompt/versions',          requireAdmin, ctrl.listPromptVersions);
router.get('/ai/prompt/active',            ctrl.getActivePrompt); // qualquer logado pode ver
router.post('/ai/prompt',                  requireAdmin, ctrl.newPromptVersion);
router.post('/ai/prompt/:id/activate',     requireAdmin, ctrl.activatePrompt);

// Análise IA + simulação
router.post('/analyze-pdf', upload.single('file'),       ctrl.analyzePdf);
router.post('/analyze-receipt', upload.single('file'),   ctrl.analyzeReceipt);
router.post('/simulate',                                 ctrl.simulate);

const receiptUpload = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'comprovante', maxCount: 1 },
  { name: 'comprovantes', maxCount: 10 },
]);

// Credit requests
router.get('/',                                          ctrl.list);
// create aceita 'file' (PDF da invoice) e N comprovantes de depósito
router.post('/', receiptUpload, ctrl.create);
router.get('/:id',                                       ctrl.get);
// send aceita 1..N comprovantes (anexa antes de enviar)
router.post('/:id/send', receiptUpload,                  ctrl.send);
router.get('/:id/receipts/:rid',                         ctrl.downloadReceiptItem);
router.post('/:id/start',                                ctrl.start);
router.post('/:id/resolve', upload.single('file'),       ctrl.resolve);
router.post('/:id/cancel',                               ctrl.cancel);
router.get('/:id/pdf',                                   ctrl.downloadPdf);
router.get('/:id/payment-receipt',                       ctrl.downloadPaymentReceipt);
router.get('/:id/evidence',                              ctrl.downloadEvidence);

export default router;
