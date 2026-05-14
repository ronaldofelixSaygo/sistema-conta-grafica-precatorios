import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/desoneracoes.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { requireStaffOrPartnerEscritorio } from '../middlewares/role.middleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const router = Router();
router.use(requireAuth);

// Helpers (qualquer logado)
router.get('/meta',          ctrl.meta);
router.get('/required-docs', ctrl.getRequiredDocsForUI);

// Config docs obrigatórios (só admin/escritório edita; ler é aberto)
router.get('/doc-configs',                  ctrl.listDocConfigs);
router.post('/doc-configs',                 requireStaffOrPartnerEscritorio, ctrl.upsertDocConfig);
router.delete('/doc-configs/:id',           requireStaffOrPartnerEscritorio, ctrl.removeDocConfig);

// Config de responsável por etapa
router.get('/step-configs',                 ctrl.listStepConfigs);
router.post('/step-configs',                requireStaffOrPartnerEscritorio, ctrl.upsertStepConfig);

// Tipos de documento configuráveis
router.get   ('/doc-tipos',                 ctrl.listDocTipos);
router.post  ('/doc-tipos',                 requireStaffOrPartnerEscritorio, ctrl.upsertDocTipo);
router.put   ('/doc-tipos/:id',             requireStaffOrPartnerEscritorio, ctrl.upsertDocTipo);
router.delete('/doc-tipos/:id',             requireStaffOrPartnerEscritorio, ctrl.deleteDocTipo);

// CRUD principal — scope é aplicado no service (cada user vê só o que pode).
// Regra de criação/cancelamento (CLIENT ou STAFF) é validada no service —
// o middleware aqui é só requireAuth (já aplicado no topo via router.use).
router.get('/',                  ctrl.list);
router.post('/',                 ctrl.create);
router.get('/:id',               ctrl.get);
router.put('/:id',               requireStaffOrPartnerEscritorio, ctrl.update);
router.post('/:id/step/:etapa',  requireStaffOrPartnerEscritorio, ctrl.setStepParceiro);
// Advance e demais ações: autorização granular no service (canActOnStep)
router.post('/:id/advance',      ctrl.advance);
router.post('/:id/approve',      requireStaffOrPartnerEscritorio, ctrl.approve);
router.post('/:id/cancel',       ctrl.cancel);

// Notas — cliente também precisa adicionar/anexar na sua etapa
router.post('/:id/notas',                    ctrl.addNota);
// Novo: upload direto cria NF + anexa o arquivo (cliente não precisa preencher campos)
router.post('/:id/notas/upload', upload.single('file'), ctrl.uploadNota);
router.post('/notas/:notaId/validar',        ctrl.validarNota);
router.post('/notas/:notaId/oficial', upload.single('file'), ctrl.anexarOficial);
router.get('/notas/:notaId/oficial',         ctrl.downloadOficial);
router.delete('/notas/:notaId',              ctrl.removeNota); // cliente pode excluir na sua etapa (validado no service)

// Documentos
router.post('/:id/documentos', upload.single('file'), ctrl.addDocumento);
router.get('/documentos/:docId',            ctrl.downloadDoc);
router.delete('/documentos/:docId',         requireStaffOrPartnerEscritorio, ctrl.removeDoc);

export default router;
