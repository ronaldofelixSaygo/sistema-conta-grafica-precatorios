// =====================================================================
// Storage S3-compatible (AWS S3 / Cloudflare R2 / MinIO).
// Abstrai upload, download, delete, e geração de URLs assinadas.
//
// Variáveis de ambiente esperadas:
//   AWS_REGION              região do bucket (ex: sa-east-1)
//   AWS_S3_BUCKET           nome do bucket
//   AWS_ACCESS_KEY_ID       credencial
//   AWS_SECRET_ACCESS_KEY   credencial
//   AWS_S3_ENDPOINT         (opcional) endpoint custom — usado pra R2/MinIO
//
// Se as variáveis não estiverem setadas, `isEnabled()` retorna false e o
// código de upload faz fallback pro armazenamento inline (Bytes no Postgres).
// =====================================================================
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const REGION   = process.env.AWS_REGION || null;
const BUCKET   = process.env.AWS_S3_BUCKET || null;
const ENDPOINT = process.env.AWS_S3_ENDPOINT || null;
const ACCESS   = process.env.AWS_ACCESS_KEY_ID || null;
const SECRET   = process.env.AWS_SECRET_ACCESS_KEY || null;

let _client = null;
function client() {
  if (_client) return _client;
  if (!REGION || !BUCKET || !ACCESS || !SECRET) return null;
  const cfg = {
    region: REGION,
    credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
  };
  if (ENDPOINT) {
    cfg.endpoint = ENDPOINT;
    cfg.forcePathStyle = true; // R2/MinIO precisam disso
  }
  _client = new S3Client(cfg);
  console.log(`[storage] S3 inicializado: bucket=${BUCKET} region=${REGION}${ENDPOINT?' endpoint='+ENDPOINT:''}`);
  return _client;
}

// `true` se as credenciais estão configuradas — toda lógica que pode cair
// pra Bytes inline checa isso primeiro.
export function isEnabled() {
  return !!(REGION && BUCKET && ACCESS && SECRET);
}
export function bucketName() { return BUCKET; }

// Sanitiza nome de arquivo pra usar dentro da key (sem acento, espaço, etc.)
const _DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');
function sanitizeFilename(name) {
  return String(name || 'arquivo')
    .normalize('NFD')
    .replace(_DIACRITICS_RE, '')
    .replace(/[^a-zA-Z0-9.\-_]/g, '_')
    .slice(0, 120);
}

// Helpers pra construir keys padronizadas. Cada tipo de anexo tem seu prefixo.
export function buildKey(category, ids, filename) {
  // ids = string ou array. Ex: ['cardId', 'attId'] ou só 'userId'
  const arr = Array.isArray(ids) ? ids : [ids];
  const safeName = sanitizeFilename(filename);
  const ts = Date.now();
  return `${category}/${arr.join('/')}/${ts}-${safeName}`;
}

// Upload direto (server-side) — recebe Buffer, sobe pro S3 e retorna a key.
export async function uploadBuffer({ key, buffer, contentType, contentDisposition }) {
  const s3 = client();
  if (!s3) throw new Error('S3 não configurado (faltam variáveis de ambiente)');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    ContentDisposition: contentDisposition || undefined,
  }));
  return key;
}

// Gera URL assinada pra download (GET). Expira em 30min por padrão.
export async function getDownloadUrl(key, { expiresIn = 1800, filename = null, inline = true } = {}) {
  const s3 = client();
  if (!s3) throw new Error('S3 não configurado');
  // Content-Disposition controlado por query param do presigned URL
  const dispositionType = inline ? 'inline' : 'attachment';
  const cd = filename
    ? `${dispositionType}; filename="${encodeURIComponent(filename)}"`
    : dispositionType;
  const cmd = new GetObjectCommand({
    Bucket: BUCKET, Key: key,
    ResponseContentDisposition: cd,
  });
  return getSignedUrl(s3, cmd, { expiresIn });
}

// Remove um objeto do bucket
export async function deleteObject(key) {
  const s3 = client();
  if (!s3 || !key) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (e) {
    console.warn('[storage] delete falhou:', key, e.message);
  }
}

// Baixa um objeto como Buffer (usado pelo script de migração reversa, etc.)
export async function downloadBuffer(key) {
  const s3 = client();
  if (!s3) throw new Error('S3 não configurado');
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of r.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Existe?
export async function exists(key) {
  const s3 = client();
  if (!s3) return false;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}
