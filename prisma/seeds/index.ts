import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

import { seedCatalog } from './catalog.seed';
import { seedConsentDocuments } from './consent.seed';
import { seedCoupons } from './coupon.seed';
import { seedGenomics } from './genomics.seed';
import { seedNotificationTriggers } from './notification.seed';
import { seedPapeis } from './papeis.seed';
import { seedQuestionnaire } from './questionnaire.seed';

const prisma = new PrismaClient();

/**
 * Seeds roles, permissions and a development admin.
 *
 * Idempotent throughout — the previous seed used bare `create` calls and blew up
 * with a unique-constraint error on the second run.
 */
async function main(): Promise<void> {
  await seedPapeis(prisma);

  await seedGenomics(prisma);
  await seedCatalog(prisma);
  await seedConsentDocuments(prisma);
  await seedCoupons(prisma);
  await seedNotificationTriggers(prisma);
  await seedQuestionnaire(prisma);
  await seedDevelopmentAdmin();
}

/**
 * Creates a local admin account.
 *
 * Guarded by NODE_ENV: a known password must never exist in production. The old
 * seed created `admin.master@email.com` with the password `12345678`
 * unconditionally.
 */
async function seedDevelopmentAdmin(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.log('· ambiente de produção — admin de desenvolvimento não criado');
    return;
  }

  const email = 'admin@genecode.local';
  const password = 'Genecode123';

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Admin gene.code',
      password: await hash(password, 12),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const master = await prisma.role.findUniqueOrThrow({ where: { slug: 'master' } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: master.id } },
    update: {},
    create: { userId: user.id, roleId: master.id },
  });

  console.log(`✓ admin de desenvolvimento: ${email} / ${password}`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed falhou:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
