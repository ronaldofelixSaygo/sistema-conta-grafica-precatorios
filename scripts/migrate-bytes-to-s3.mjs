// =====================================================================
// Script de migração: move bytes existentes no Postgres pro S3.
//
// O que faz:
//   - Para cada tabela com coluna Bytes legada, sobe o conteúdo pro S3,
//     grava a s3Key correspondente e zera os bytes (libera espaço do Neon).
//
// Tabelas cobertas:
//   * KanbanAttachment.content              → s3Key
//   * DesoneracaoNota.oficialBytes          → oficialS3Key
//   * DesoneracaoDocumento.bytes            → s3Key
//   * CreditRequest.inputPdfBytes           → inputPdfS3Key
//   * CreditRequest.resolutionAttachmentBytes → resolutionAttachmentS3Key
//   * User.avatarBytes                      → avatarS3Key
//
// Execução:
//   $ node scripts/migrate-bytes-to-s3.mjs
//   $ node scripts/migrate-bytes-to-s3.mjs --dry-run    # só lista o que faria
//   $ node scripts/migrate-bytes-to-s3.mjs --only=kanban,nota   # filtros
//
// Variáveis de ambiente obrigatórias:
//   AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
//   DATABASE_URL (igual ao app)
//
// Idempotente: pula registros que já têm s3Key preenchida.
// =====================================================================
import { PrismaClient } from '@prisma/client';
import * as storage from '../src/services/storage.service.js';

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const onlyArg = [...args].find(a => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.split('=')[1].split(',')) : null;

function shouldRun(name) { return !ONLY || ONLY.has(name); }

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
  return `${(n/1024/1024).toFixed(2)} MB`;
}

function safeMime(mime, fallback = 'application/octet-stream') {
  return mime || fallback;
}

async function migrateKanbanAttachments() {
  if (!shouldRun('kanban')) return;
  console.log('\n=== KanbanAttachment ===');
  const rows = await prisma.kanbanAttachment.findMany({
    where: { s3Key: null, content: { not: null } },
    select: { id: true, cardId: true, filename: true, mimeType: true, size: true, content: true },
  });
  console.log(`Encontrados: ${rows.length}`);
  let migrated = 0, totalBytes = 0;
  for (const r of rows) {
    const key = storage.buildKey('kanban', r.cardId, r.filename);
    const buf = Buffer.from(r.content);
    totalBytes += buf.length;
    console.log(`  ${r.id}  ${r.filename}  (${fmtBytes(buf.length)})  → ${key}`);
    if (!DRY_RUN) {
      await storage.uploadBuffer({ key, buffer: buf, contentType: safeMime(r.mimeType) });
      await prisma.kanbanAttachment.update({
        where: { id: r.id }, data: { s3Key: key, content: null },
      });
    }
    migrated++;
  }
  console.log(`Migrados: ${migrated} (${fmtBytes(totalBytes)})`);
}

async function migrateDesoneracaoNotas() {
  if (!shouldRun('nota')) return;
  console.log('\n=== DesoneracaoNota (oficial) ===');
  const rows = await prisma.desoneracaoNota.findMany({
    where: { oficialS3Key: null, oficialBytes: { not: null } },
    select: {
      id: true, desoneracaoId: true,
      oficialName: true, oficialMime: true, oficialBytes: true,
    },
  });
  console.log(`Encontrados: ${rows.length}`);
  let migrated = 0, totalBytes = 0;
  for (const r of rows) {
    const key = storage.buildKey('desoneracoes', [r.desoneracaoId, 'notas', r.id], r.oficialName || 'nota.pdf');
    const buf = Buffer.from(r.oficialBytes);
    totalBytes += buf.length;
    console.log(`  ${r.id}  ${r.oficialName}  (${fmtBytes(buf.length)})  → ${key}`);
    if (!DRY_RUN) {
      await storage.uploadBuffer({ key, buffer: buf, contentType: safeMime(r.oficialMime) });
      await prisma.desoneracaoNota.update({
        where: { id: r.id }, data: { oficialS3Key: key, oficialBytes: null },
      });
    }
    migrated++;
  }
  console.log(`Migrados: ${migrated} (${fmtBytes(totalBytes)})`);
}

async function migrateDesoneracaoDocumentos() {
  if (!shouldRun('doc')) return;
  console.log('\n=== DesoneracaoDocumento ===');
  const rows = await prisma.desoneracaoDocumento.findMany({
    where: { s3Key: null, bytes: { not: null } },
    select: {
      id: true, desoneracaoId: true, tipo: true,
      name: true, mime: true, bytes: true,
    },
  });
  console.log(`Encontrados: ${rows.length}`);
  let migrated = 0, totalBytes = 0;
  for (const r of rows) {
    const key = storage.buildKey('desoneracoes', [r.desoneracaoId, 'docs', r.tipo || 'OUTRO'], r.name || 'doc');
    const buf = Buffer.from(r.bytes);
    totalBytes += buf.length;
    console.log(`  ${r.id}  ${r.name}  (${fmtBytes(buf.length)})  → ${key}`);
    if (!DRY_RUN) {
      await storage.uploadBuffer({ key, buffer: buf, contentType: safeMime(r.mime) });
      await prisma.desoneracaoDocumento.update({
        where: { id: r.id }, data: { s3Key: key, bytes: null },
      });
    }
    migrated++;
  }
  console.log(`Migrados: ${migrated} (${fmtBytes(totalBytes)})`);
}

async function migrateCreditRequestsInputPdf() {
  if (!shouldRun('credit-input')) return;
  console.log('\n=== CreditRequest.inputPdf ===');
  const rows = await prisma.creditRequest.findMany({
    where: { inputPdfS3Key: null, inputPdfBytes: { not: null } },
    select: { id: true, inputPdfName: true, inputPdfBytes: true },
  });
  console.log(`Encontrados: ${rows.length}`);
  let migrated = 0, totalBytes = 0;
  for (const r of rows) {
    const fname = r.inputPdfName || `request-${r.id}.pdf`;
    const key = storage.buildKey('credit-requests', [r.id, 'input'], fname);
    const buf = Buffer.from(r.inputPdfBytes);
    totalBytes += buf.length;
    console.log(`  ${r.id}  ${fname}  (${fmtBytes(buf.length)})  → ${key}`);
    if (!DRY_RUN) {
      await storage.uploadBuffer({ key, buffer: buf, contentType: 'application/pdf' });
      await prisma.creditRequest.update({
        where: { id: r.id }, data: { inputPdfS3Key: key, inputPdfBytes: null },
      });
    }
    migrated++;
  }
  console.log(`Migrados: ${migrated} (${fmtBytes(totalBytes)})`);
}

async function migrateCreditRequestsResolution() {
  if (!shouldRun('credit-resolution')) return;
  console.log('\n=== CreditRequest.resolutionAttachment ===');
  const rows = await prisma.creditRequest.findMany({
    where: { resolutionAttachmentS3Key: null, resolutionAttachmentBytes: { not: null } },
    select: {
      id: true,
      resolutionAttachmentName: true,
      resolutionAttachmentMime: true,
      resolutionAttachmentBytes: true,
    },
  });
  console.log(`Encontrados: ${rows.length}`);
  let migrated = 0, totalBytes = 0;
  for (const r of rows) {
    const fname = r.resolutionAttachmentName || `resolution-${r.id}`;
    const key = storage.buildKey('credit-requests', [r.id, 'resolution'], fname);
    const buf = Buffer.from(r.resolutionAttachmentBytes);
    totalBytes += buf.length;
    console.log(`  ${r.id}  ${fname}  (${fmtBytes(buf.length)})  → ${key}`);
    if (!DRY_RUN) {
      await storage.uploadBuffer({
        key, buffer: buf, contentType: safeMime(r.resolutionAttachmentMime),
      });
      await prisma.creditRequest.update({
        where: { id: r.id }, data: { resolutionAttachmentS3Key: key, resolutionAttachmentBytes: null },
      });
    }
    migrated++;
  }
  console.log(`Migrados: ${migrated} (${fmtBytes(totalBytes)})`);
}

async function migrateAvatars() {
  if (!shouldRun('avatar')) return;
  console.log('\n=== User.avatar ===');
  const rows = await prisma.user.findMany({
    where: { avatarS3Key: null, avatarBytes: { not: null } },
    select: { id: true, name: true, avatarMime: true, avatarBytes: true },
  });
  console.log(`Encontrados: ${rows.length}`);
  let migrated = 0, totalBytes = 0;
  for (const r of rows) {
    const mime = r.avatarMime || 'image/png';
    const ext  = (mime.split('/')[1] || 'png').toLowerCase();
    const key  = storage.buildKey('avatars', r.id, `avatar.${ext}`);
    const buf  = Buffer.from(r.avatarBytes);
    totalBytes += buf.length;
    console.log(`  ${r.id}  ${r.name}  (${fmtBytes(buf.length)})  → ${key}`);
    if (!DRY_RUN) {
      await storage.uploadBuffer({ key, buffer: buf, contentType: mime });
      await prisma.user.update({
        where: { id: r.id }, data: { avatarS3Key: key, avatarBytes: null },
      });
    }
    migrated++;
  }
  console.log(`Migrados: ${migrated} (${fmtBytes(totalBytes)})`);
}

async function main() {
  if (!storage.isEnabled()) {
    console.error('[ERRO] S3 não configurado. Defina AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.');
    process.exit(1);
  }
  console.log(`\n>>> Migração Bytes → S3 (bucket: ${storage.bucketName()})`);
  if (DRY_RUN) console.log('>>> MODO DRY-RUN — nada será alterado.');
  if (ONLY)    console.log(`>>> Filtros: ${[...ONLY].join(', ')}`);
  const t0 = Date.now();
  try {
    await migrateKanbanAttachments();
    await migrateDesoneracaoNotas();
    await migrateDesoneracaoDocumentos();
    await migrateCreditRequestsInputPdf();
    await migrateCreditRequestsResolution();
    await migrateAvatars();
    const sec = ((Date.now() - t0)/1000).toFixed(1);
    console.log(`\n=== Concluído em ${sec}s ===`);
  } catch (e) {
    console.error('\n[FALHA]', e);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main();
