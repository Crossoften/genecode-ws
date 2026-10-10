import { PrismaClient } from '@prisma/client';

import { seedPapeis } from './papeis.seed';

/**
 * Publica só os papéis e as permissões (`npm run seed:papeis`).
 *
 * Existe para o deploy: o seed completo sobrescreve o catálogo de produtos e
 * zera as promoções (ver a nota em `papeis.seed.ts`). Em homologação, onde o
 * cliente edita preço pela tela, isto é a diferença entre publicar um papel
 * novo e apagar o trabalho dele.
 */
const prisma = new PrismaClient();

seedPapeis(prisma)
  .catch((erro: unknown) => {
    console.error('Seed de papéis falhou:', erro);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
