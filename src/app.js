import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import apiRoutes from './routes/index.js';
import { apiErrorHandler, notFoundApi } from './middlewares/error.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // necessário no Render p/ req.ip funcionar

  app.use(helmet({
    contentSecurityPolicy: false, // o frontend usa CDNs, ajustar se quiser
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());
  app.use(morgan(env.isProd ? 'combined' : 'dev'));

  // rate limit nas rotas de auth (anti brute-force)
  const authLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10min
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/auth/login', authLimiter);

  // ─── API ────────────────────────────────────────────────────────
  app.use('/api', apiRoutes);
  app.use('/api', notFoundApi);
  app.use('/api', apiErrorHandler);

  // ─── Static SPA ─────────────────────────────────────────────────
  const publicDir = path.resolve(__dirname, '..', 'public');
  app.use(express.static(publicDir, { extensions: ['html'] }));

  // SPA fallback — qualquer rota não-API serve o index.html
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}
