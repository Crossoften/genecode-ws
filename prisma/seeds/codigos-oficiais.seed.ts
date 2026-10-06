import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { lerListaOficial } from '../../src/contexts/lab/domain/lista-oficial';

/**
 * Importa a lista primitiva dos 500 mil códigos da Genoa.
 *
 * O cliente **produz** os números — "500 mil números selecionados pela nossa
 * informática", nas palavras do Dr. Câmara — e a plataforma consome. Até 06/10
 * a lista nunca tinha sido importada e o sistema sorteava códigos próprios, de
 * modo que nenhum envelope impresso pela Genoa ativava.
 *
 * Idempotente: roda quantas vezes quiser. Nunca mexe em código já queimado.
 *
 *   npm run seed:codigos
 */
const ARQUIVO = join(__dirname, 'data', 'codigos-oficiais.csv.gz');

/** Tamanho do lote de inserção. 5 000 linhas por INSERT cabe no `max_allowed_packet`. */
const LOTE = 5_000;

export async function seedCodigosOficiais(prisma: PrismaClient): Promise<void> {
  const lista = lerListaOficial(gunzipSync(readFileSync(ARQUIVO)).toString('utf8'));
  const inutilizaveis = lista.filter((linha) => !linha.usable).length;
  console.log(
    `  lista oficial: ${lista.length} códigos, ` +
      `${inutilizaveis} de base trivial que nunca serão impressos`,
  );

  const jaImportados = await prisma.activationCode.count();
  if (jaImportados >= lista.length) {
    console.log(`  já importados (${jaImportados}); nada a fazer`);
    return;
  }

  // `skipDuplicates` deixa o import repetível sem tocar no que já foi queimado.
  let inseridos = 0;
  for (let i = 0; i < lista.length; i += LOTE) {
    const { count } = await prisma.activationCode.createMany({
      data: lista.slice(i, i + LOTE),
      skipDuplicates: true,
    });
    inseridos += count;
    if ((i / LOTE) % 20 === 0) {
      process.stdout.write(`\r  importando… ${Math.min(i + LOTE, lista.length)}/${lista.length}`);
    }
  }
  console.log(
    `\r  importados ${inseridos} códigos novos (total ${await prisma.activationCode.count()})`,
  );
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedCodigosOficiais(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (erro) => {
      console.error(erro);
      await prisma.$disconnect();
      process.exit(1);
    });
}
