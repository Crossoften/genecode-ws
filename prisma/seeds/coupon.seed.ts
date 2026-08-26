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
  // Cupom de lançamento do documento de correções de 26/08: R$ 650 → R$ 520 e
  // R$ 1.105 → R$ 884, exatos 20%. Campanha da casa — sem comissão de parceiro.
  { code: 'LANC26', discountPercent: 20, commissionPercent: 0, partnerName: 'Lançamento 2026' },
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
