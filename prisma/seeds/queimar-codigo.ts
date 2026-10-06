import type { PrismaClient } from '@prisma/client';

/**
 * Tira o próximo código da lista primitiva da Genoa, para uso nas sementes.
 *
 * Existe porque as sementes também **sorteavam** códigos, do mesmo jeito que o
 * caso de uso de emissão fazia até 06/10 — e a colisão que isso cria é a mesma:
 * metade do espaço de 6 dígitos já está impressa em envelope do cliente. Uma
 * semente que inventasse um código do pool deixaria uma mina: o lote real que
 * tentasse queimar aquele número esbarraria na unicidade de `kits.code`, meses
 * depois, sem ninguém entender por quê.
 *
 * Em ambiente de semente a concorrência não existe, então basta ordenar pelo
 * sequencial e marcar. A emissão de verdade (`EmitirKitsUseCase`) usa
 * `FOR UPDATE`.
 */
export async function queimarCodigo(prisma: PrismaClient, batchId: string): Promise<string> {
  const proximo = await prisma.activationCode.findFirst({
    where: { burnedAt: null, usable: true },
    orderBy: { sequencial: 'asc' },
    select: { sequencial: true, code: true },
  });

  if (!proximo) {
    throw new Error(
      'A lista oficial de códigos não está importada. Rode `npm run seed:codigos` antes das sementes.',
    );
  }

  await prisma.activationCode.update({
    where: { sequencial: proximo.sequencial },
    data: { burnedAt: new Date(), batchId },
  });
  return proximo.code;
}
