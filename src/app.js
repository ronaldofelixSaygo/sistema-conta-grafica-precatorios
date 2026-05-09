import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import apiRoutes from './routes/index.js';
import { apiErrorHandler, notFoundApi } from './middlewares/error.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// === Versão dos assets (cache-busting) ===
// Usa o hash curto do commit em produção; em dev, o timestamp do boot.
// Render injeta RENDER_GIT_COMMIT automaticamente; outros podem injetar GIT_COMMIT.
function detectAssetVersion() {
  const fromEnv = (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 7);
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return String(Date.now()); // fallback: timestamp do boot
  }
}
const ASSET_VERSION = detectAssetVersion();
console.log(`[assets] versão: ${ASSET_VERSION}`);

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

  // Lê o index.html e injeta a versão atual nos `?v=...` e em window.ASSETV.
  // Em prod cacheia o resultado em memória; em dev relê a cada request.
  let indexHtmlCache = null;
  function renderIndex() {
    if (indexHtmlCache && env.isProd) return indexHtmlCache;
    const raw = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const replaced = raw
      .replace(/(\?v=)[\w.-]+/g, `$1${ASSET_VERSION}`)
      .replace(/window\.ASSETV\s*=\s*['"][^'"]*['"]/, `window.ASSETV='${ASSET_VERSION}'`);
    if (env.isProd) indexHtmlCache = replaced;
    return replaced;
  }

  function serveIndex(_req, res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(renderIndex());
  }

  // Root e /index.html sempre passam pelo handler dinâmico (com versão injetada)
  app.get(['/', '/index.html'], serveIndex);

  // Static assets (JS/CSS/imagens/fontes): cache agressivo porque a URL
  // carrega ?v=<commit-hash>; ao trocar de versão, a URL muda e o browser
  // refaz o download.
  app.use(express.static(publicDir, {
    index: false, // já tratamos / e /index.html acima
    extensions: ['html'],
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (/\.(js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));

  // SPA fallback — qualquer rota não-API serve o index.html
  app.get(/^\/(?!api).*/, serveIndex);

  return app;
}
