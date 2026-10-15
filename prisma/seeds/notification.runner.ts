import { PrismaClient } from '@prisma/client';

import { seedNotificationTriggers } from './notification.seed';

/**
 * Publica só os gatilhos de notificação (`npm run seed:notificacoes`).
 *
 * Existe para o deploy, como o `seed:papeis`: evita o seed completo (que zera
 * promoções). Em homologação/produção, cria os gatilhos NOVOS da fase
 * laboratorial — `ANALYSIS_STARTED` e `ANALYSIS_IN_PROGRESS` (card #526) — sem
 * tocar no catálogo.
 *
 * ⚠️ O `update` do seed é vazio de propósito: gatilho que já existe NÃO é
 * sobrescrito, para não apagar o texto/canais que o admin editou pela tela. Por
 * isso os textos definitivos de "Amostra recebida" e "Resultado disponível"
 * (que mudam gatilhos já existentes) devem ser aplicados pela tela de
 * Notificações do admin — este runner cria só o que é novo.
 *
 * Rode DEPOIS do `prisma migrate deploy` (a migração acrescenta os dois valores
 * ao enum; sem ela, criar os gatilhos novos falha).
 */
const prisma = new PrismaClient();

seedNotificationTriggers(prisma)
  .catch((erro: unknown) => {
    console.error('Seed de gatilhos de notificação falhou:', erro);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
