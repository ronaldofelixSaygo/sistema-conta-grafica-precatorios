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

export default router;
