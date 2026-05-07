import 'dotenv/config';

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
};

if (!env.DATABASE_URL) {
  console.warn('⚠ DATABASE_URL não definida — defina antes de rodar migrations.');
}
