import type { PrismaService } from '@infra/database/prisma.service';

/**
 * Every status a sale row can carry: the four `PayoutStatus` values plus the
 * derived `NOT_ISSUED` for paid orders that predate automatic payout creation.
 * The `?repasse=` filter validates against this set, not against the Prisma
 * enum, because `NOT_ISSUED` is a status the API itself emits — a chip the
 * screen shows must be a chip the API can filter by.
 */
export const SALE_PAYOUT_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SETTLED',
  'REVERSED',
  'NOT_ISSUED',
] as const;

export type SalePayoutStatus = (typeof SALE_PAYOUT_STATUSES)[number];

export interface SaleRow {
  /** Só o número do pedido e o produto. Nunca dado do comprador. */
  readonly orderNumber: string;
  readonly productName: string;
  readonly amountCents: number;
  readonly commissionCents: number;
  readonly payoutStatus: SalePayoutStatus;
  readonly date: Date;
}

export interface PartnerSales {
  /** Every confirmed sale of the coupon, newest first. */
  readonly sales: readonly SaleRow[];
  readonly settledCents: number;
  readonly pendingCents: number;
}

/**
 * Sales of the partner's coupon, shared by the dashboard and the full list.
 *
 * ### O que o parceiro NÃO vê
 *
 * O protótipo aprovado traz um aviso explícito na tela de vendas: *"exibimos
 * apenas o número do pedido e o produto — nunca dados pessoais"*. Faz sentido:
 * o parceiro não tem relação com o comprador além de ter indicado a compra, e
 * num produto de saúde saber quem comprou já é informação sensível.
 *
 * Então nome, e-mail, CPF e endereço do comprador não saem daqui.
 */
export async function fetchPartnerSales(
  prisma: PrismaService,
  partner: { readonly id: string; readonly couponCode: string },
): Promise<PartnerSales> {
  const orders = await prisma.order.findMany({
    where: {
      couponCode: partner.couponCode,
      status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
    },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });

  const payouts = await prisma.payout.findMany({ where: { partnerId: partner.id } });
  const payoutByOrder = new Map(payouts.map((payout) => [payout.orderId, payout]));

  const settledCents = payouts
    .filter((payout) => payout.status === 'SETTLED')
    .reduce((sum, payout) => sum + payout.amountCents, 0);
  const pendingCents = payouts
    .filter((payout) => payout.status === 'PENDING' || payout.status === 'PROCESSING')
    .reduce((sum, payout) => sum + payout.amountCents, 0);

  return {
    sales: orders.map((order) => ({
      orderNumber: order.number,
      productName: order.items[0]?.productName ?? '—',
      amountCents: order.totalCents,
      commissionCents: order.commissionCents ?? 0,
      // Sem registro de repasse a situação é NOT_ISSUED, não PENDING.
      //
      // O default anterior era 'PENDING', e isso produzia uma tela que não
      // fechava: quatro vendas marcadas "a receber" enquanto o total pendente
      // — que soma repasses reais — contava só duas. O parceiro veria a
      // diferença e não teria como explicá-la.
      //
      // Na prática só afeta pedidos pagos antes de o repasse passar a nascer
      // junto do pagamento; daqui para frente todo pedido com comissão tem
      // registro. Mas o dado precisa ser honesto sobre o passado também.
      payoutStatus: payoutByOrder.get(order.id)?.status ?? 'NOT_ISSUED',
      date: order.createdAt,
    })),
    settledCents,
    pendingCents,
  };
}
