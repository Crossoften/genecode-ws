import type { PrismaClient } from '@prisma/client';

/**
 * Cupons iniciais.
 *
 * Os dois primeiros vêm do protótipo aprovado. A comissão é **variável por
 * parceiro** conforme a decisão F6, e o padrão de 20% resolve a inconsistência
 * da reunião de 01/06, onde Augusto citou "20%" mas os números do exemplo
 * (R$ 90 sobre R$ 300) davam 30%.
 */
const COUPONS = [
  { code: 'PARCEIRO10', discountPercent: 10, commissionPercent: 20, partnerName: 'Parceiro exemplo' },
  { code: 'GENE15', discountPercent: 15, commissionPercent: 20, partnerName: 'Campanha GeneCode' },
  { code: 'ESGOTADO', discountPercent: 10, commissionPercent: 20, partnerName: 'Teste de limite', maxUses: 0 },
];

/** Semeia os cupons. Idempotente por código. */
export async function seedCoupons(prisma: PrismaClient): Promise<void> {
  for (const coupon of COUPONS) {
    await prisma.coupon.upsert({
      where: { code: coupon.code },
      update: {
        discountPercent: coupon.discountPercent,
        commissionPercent: coupon.commissionPercent,
      },
      create: coupon,
    });
  }
  console.log(`✓ ${COUPONS.length} cupons`);
}
