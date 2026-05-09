// Roda o seed dataset starter de NCM/anuentes/ICMS UF.
// Usa a mesma função do endpoint admin (/api/admin/seed-ncm).
import { PrismaClient } from '@prisma/client';
import { runNcmSeed } from '../src/services/ncmSeed.service.js';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
  const r = await runNcmSeed();
  console.log(`✓ NCM seed: ${r.ufs} UFs, ${r.ncms} NCMs, ${r.anuentes} anuentes`);
}

main()
  .catch(e => { console.error('[seed-ncm] erro:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
