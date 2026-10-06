import type { PrismaClient } from '@prisma/client';

/**
 * Tira um código da lista primitiva da Genoa, para uso nas sementes.
 *
 * Existe porque as sementes também **sorteavam** códigos, e a colisão que isso
 * cria é a mesma que tirou o sistema do ar: metade do espaço de 6 dígitos já
 * está impressa em envelope do cliente. Uma semente que inventasse um código
 * da lista deixaria uma mina — o registro de verdade daquele número esbarraria
 * na unicidade de `kits.code`, meses depois, sem ninguém entender por quê.
 *
 * Na vida real quem queima é o registro do kit, feito pela pessoa que abriu a
 * caixa. A semente só precisa de um número legítimo e inédito, então pega o
 * primeiro disponível.
 */
export async function queimarCodigo(prisma: PrismaClient, orderId?: string): Promise<string> {
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
    data: { burnedAt: new Date(), orderId: orderId ?? null },
  });
  return proximo.code;
}
