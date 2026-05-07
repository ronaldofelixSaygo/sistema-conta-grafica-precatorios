import { Router } from 'express';
import * as ctrl from '../controllers/relatorios.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();
router.use(requireAuth);
router.get('/relatorio',       ctrl.relatorioJson);
router.get('/relatorio/excel', ctrl.relatorioExcel);
router.get('/relatorio/pdf',   ctrl.relatorioPdf);
export default router;
