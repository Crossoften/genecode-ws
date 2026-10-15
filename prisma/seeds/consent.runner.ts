import { PrismaClient } from '@prisma/client';

import { seedConsentDocuments } from './consent.seed';

/**
 * Publica só os documentos legais (`npm run seed:consent`).
 *
 * Existe para o deploy, pelo mesmo motivo do `seed:papeis`: o seed completo
 * sobrescreve o catálogo e zera as promoções. Em homologação/produção, onde o
 * cliente edita preço pela tela, publicar a Política e o Termo definitivos
 * (card #526) não pode apagar esse trabalho. Este runner só faz `upsert` dos
 * documentos de consentimento — idempotente por tipo + versão.
 */
const prisma = new PrismaClient();

seedConsentDocuments(prisma)
  .catch((erro: unknown) => {
    console.error('Seed de documentos legais falhou:', erro);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
