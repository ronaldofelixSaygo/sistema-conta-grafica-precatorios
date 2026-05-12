import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/desoneracoes.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireStaffOrPartnerEscritorio } from '../middlewares/role.middleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const router = Router();
router.use(requireAuth);

// Helpers
router.get('/meta',             ctrl.meta);
router.get('/required-docs',    ctrl.getRequiredDocsForUI);

// Config docs obrigatórios (gerenciada em Parâmetros)
router.get('/doc-configs',                  ctrl.listDocConfigs);
router.post('/doc-configs',                 requireStaffOrPartnerEscritorio, ctrl.upsertDocConfig);
router.delete('/doc-configs/:id',           requireStaffOrPartnerEscritorio, ctrl.removeDocConfig);

// CRUD principal
router.get('/',                  ctrl.list);
router.post('/',                 requireStaffOrPartnerEscritorio, ctrl.create);
router.get('/:id',               ctrl.get);
router.put('/:id',               requireStaffOrPartnerEscritorio, ctrl.update);
router.post('/:id/step/:etapa',  requireStaffOrPartnerEscritorio, ctrl.setStepParceiro);
router.post('/:id/advance',      requireStaffOrPartnerEscritorio, ctrl.advance);
router.post('/:id/approve',      requireStaffOrPartnerEscritorio, ctrl.approve);
router.post('/:id/cancel',       requireStaffOrPartnerEscritorio, ctrl.cancel);

// Notas
router.post('/:id/notas',                    requireStaffOrPartnerEscritorio, ctrl.addNota);
router.post('/notas/:notaId/validar',        requireStaffOrPartnerEscritorio, ctrl.validarNota);
router.post('/notas/:notaId/oficial', upload.single('file'), requireStaffOrPartnerEscritorio, ctrl.anexarOficial);
router.get('/notas/:notaId/oficial',         ctrl.downloadOficial);
router.delete('/notas/:notaId',              requireStaffOrPartnerEscritorio, ctrl.removeNota);

// Documentos
router.post('/:id/documentos', upload.single('file'), requireStaffOrPartnerEscritorio, ctrl.addDocumento);
router.get('/documentos/:docId',            ctrl.downloadDoc);
router.delete('/documentos/:docId',         requireStaffOrPartnerEscritorio, ctrl.removeDoc);

export default router;
