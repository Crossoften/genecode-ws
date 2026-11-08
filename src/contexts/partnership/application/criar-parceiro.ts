import type { Partner, PartnerType, Prisma } from '@prisma/client';

import { suggestCouponCode } from '../domain/coupon-code';
import { BOLO_PADRAO_PERCENT } from '../domain/rede';

/**
 * Comissão gravada no cupom do parceiro.
 *
 * É o bolo da rede — os mesmos 20 pontos de `BOLO_PADRAO_PERCENT`. Fica aqui
 * por compatibilidade: `order-pricing` ainda calcula `commissionCents` a partir
 * do cupom, e a cascata da rede reparte **esse** valor. Quando a onda 2 mover o
 * cálculo para a cadeia, este campo vira só o total do bolo.
 *
 * O desconto padrão saiu em 03/10: cupom de parceiro é identificador, não
 * oferta. Desconto fica com a Genoa, em campanha própria.
 */
export const DEFAULT_COMMISSION_PERCENT = BOLO_PADRAO_PERCENT;

/** Posição herdada de um convite da rede. Sem ela, o parceiro nasce raiz. */
export interface HerancaDeConvite {
  readonly conviteId: string;
  readonly parentId: string;
  readonly level: number;
  readonly sharePercent: number;
}

export interface NovoParceiro {
  readonly userId: string;
  readonly type: PartnerType;
  readonly displayName: string;
  readonly document: string;
  readonly channel?: string | null;
  readonly pixKeyType?: string | null;
  readonly pixKey?: string | null;
  readonly heranca?: HerancaDeConvite | null;
}

/**
 * Cria o parceiro, o cupom dele e dá o papel `affiliate` à conta — dentro da
 * transação de quem chama.
 *
 * Saiu do `POST /parceiro/cadastro` em 08/11 (GC-N05-14): a aprovação de uma
 * solicitação faz exatamente a mesma coisa, e duas cópias do nascimento do
 * parceiro divergiriam no primeiro ajuste de cupom ou de rede.
 *
 * O papel é **somado** (`upsert`), nunca trocado: o treinador continua
 * treinador, o usuário continua com os exames dele.
 */
export async function criarParceiro(
  tx: Prisma.TransactionClient,
  input: NovoParceiro,
): Promise<Partner> {
  const taken = new Set((await tx.coupon.findMany({ select: { code: true } })).map((c) => c.code));
  const couponCode = suggestCouponCode(input.displayName, taken);

  // O cupom e o parceiro nascem juntos: um parceiro sem cupom não vende
  // nada, e é pelo cupom que a cadeia é encontrada na hora do split.
  //
  // Desconto ZERO: para o parceiro o cupom é identificador, não oferta.
  // Decisão do André em 03/10 — desconto fica só com a Genoa, em campanha
  // própria, para a margem do split não disputar com a da promoção.
  await tx.coupon.create({
    data: {
      code: couponCode,
      discountPercent: 0,
      commissionPercent: DEFAULT_COMMISSION_PERCENT,
      partnerName: input.displayName,
    },
  });

  const heranca = input.heranca ?? null;
  const created = await tx.partner.create({
    data: {
      userId: input.userId,
      type: input.type,
      displayName: input.displayName,
      document: input.document,
      channel: input.channel ?? null,
      pixKeyType: input.pixKeyType ?? null,
      pixKey: input.pixKey ?? null,
      couponCode,
      parentId: heranca?.parentId ?? null,
      level: heranca?.level ?? 1,
      sharePercent: heranca?.sharePercent ?? BOLO_PADRAO_PERCENT,
    },
  });

  if (heranca) {
    await tx.partnerInvite.update({
      where: { id: heranca.conviteId },
      data: { acceptedAt: new Date(), acceptedByPartnerId: created.id },
    });
  }

  const role = await tx.role.findUnique({ where: { slug: 'affiliate' } });
  if (role) {
    await tx.userRole.upsert({
      where: { userId_roleId: { userId: input.userId, roleId: role.id } },
      update: {},
      create: { userId: input.userId, roleId: role.id },
    });
  }

  return created;
}
