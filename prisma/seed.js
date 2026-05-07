// Seed inicial — cria 1º usuário Adm se não existir.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@saygogroup.com.br').toLowerCase();
  const pwd   = process.env.SEED_ADMIN_PASSWORD || 'TrocarEssaSenhaJa!';
  const name  = process.env.SEED_ADMIN_NAME || 'Administrador';

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    console.log(`✓ Admin já existe: ${email}`);
    return;
  }
  const passwordHash = await bcrypt.hash(pwd, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, name, role: 'ADM', active: true },
  });
  console.log(`✓ Admin criado:  ${user.email}  (senha: ${pwd})`);
  console.log(`  ⚠ Altere a senha após o 1º login.`);
}

main().catch((e) => { console.error(e); process.exit(1); })
      .finally(() => prisma.$disconnect());
