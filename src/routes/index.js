import { Router } from 'express';
import auth from './auth.routes.js';
import users from './users.routes.js';
import clientes from './clientes.routes.js';
import movimentacoes from './movimentacoes.routes.js';
import dashboard from './dashboard.routes.js';
import relatorios from './relatorios.routes.js';
import importR from './import.routes.js';
import audit from './audit.routes.js';
import chat from './chat.routes.js';
import kanban from './kanban.routes.js';
import partnerRequest from './partnerRequest.routes.js';
import admin from './admin.routes.js';
import parceiros from './parceiros.routes.js';
import permissions from './permissions.routes.js';
import comissoes from './comissoes.routes.js';
import emailR from './email.routes.js';
import creditRequests from './creditRequest.routes.js';
import ncm from './ncm.routes.js';
import partnerKinds from './partnerKind.routes.js';
import desoneracoes from './desoneracoes.routes.js';

const router = Router();

router.get('/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

router.use('/auth',           auth);
router.use('/users',          users);
router.use('/clientes',       clientes);
router.use('/movimentacoes',  movimentacoes);
router.use(                   dashboard);   // /dashboard, /saldos, /comissoes, /alertas
router.use(                   relatorios);  // /relatorio, /relatorio/excel, /relatorio/pdf
router.use(                   importR);     // /import
router.use('/audit',           audit);
router.use('/chat',            chat);
router.use('/kanban',          kanban);
router.use('/partner-requests', partnerRequest);
router.use('/admin',           admin);
router.use('/parceiros',       parceiros);
router.use('/permissions',     permissions);
router.use('/comissoes',       comissoes);
router.use('/email',           emailR);
router.use('/credit-requests', creditRequests);
router.use('/ncm',             ncm);
router.use('/partner-kinds',   partnerKinds);
router.use('/desoneracoes',    desoneracoes);

export default router;
