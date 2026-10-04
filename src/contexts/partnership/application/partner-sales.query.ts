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
  /**
   * O que ESTE parceiro ganhou nesta venda — não a comissão do pedido.
   *
   * Com rede, os dois números são diferentes: numa venda do quarto nível o
   * pedido gera 20% de bolo, e quem está na raiz leva 7. Mostrar a comissão do
   * pedido faria o parceiro esperar dinheiro que não é dele.
   */
  readonly commissionCents: number;
  readonly payoutStatus: SalePayoutStatus;
  readonly date: Date;
  /** Nível deste parceiro na venda. 1 quando foi ele quem vendeu com o cupom. */
  readonly level: number;
  /** Venda própria ou da rede abaixo. */
  readonly origem: 'PROPRIA' | 'REDE';
  /** Quem vendeu, quando foi alguém da rede. Nunca o comprador. */
  readonly vendidoPor: string | null;
}

export interface PartnerSales {
  /** Every confirmed sale of the coupon, newest first. */
  readonly sales: readonly SaleRow[];
  readonly settledCents: number;
  readonly pendingCents: number;
}

/**
 * O que este parceiro ganhou, pela própria venda e pela rede abaixo dele.
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
  // A lista é dirigida pelos REPASSES, não pelo cupom.
  //
  // Com rede, o parceiro ganha de vendas feitas por quem está abaixo dele, com
  // outro cupom. Listar só o próprio cupom esconderia justamente a receita que
  // a rede existe para gerar. O cupom continua entrando para não perder as
  // vendas antigas, anteriores ao repasse automático.
  const payouts = await prisma.payout.findMany({ where: { partnerId: partner.id } });
  const payoutByOrder = new Map(payouts.map((payout) => [payout.orderId, payout]));

  const orders = await prisma.order.findMany({
    where: {
      status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
      OR: [{ couponCode: partner.couponCode }, { id: { in: [...payoutByOrder.keys()] } }],
    },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });

  // Nome de quem vendeu, para as vendas da rede. Só o parceiro — nunca o comprador.
  const cuponsDaRede = [
    ...new Set(
      orders
        .map((order) => order.couponCode)
        .filter((code): code is string => code !== null && code !== partner.couponCode),
    ),
  ];
  const vendedores = new Map(
    (cuponsDaRede.length === 0
      ? []
      : await prisma.partner.findMany({
          where: { couponCode: { in: cuponsDaRede } },
          select: { couponCode: true, displayName: true },
        })
    ).map((p) => [p.couponCode, p.displayName]),
  );

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
      // A fatia DESTE parceiro. Sem repasse — venda antiga, do próprio cupom —
      // cai na comissão do pedido, que naquele tempo era toda dele.
      commissionCents: payoutByOrder.get(order.id)?.amountCents ?? order.commissionCents ?? 0,
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
      level: payoutByOrder.get(order.id)?.level ?? 1,
      origem: order.couponCode === partner.couponCode ? ('PROPRIA' as const) : ('REDE' as const),
      vendidoPor:
        order.couponCode === partner.couponCode
          ? null
          : (vendedores.get(order.couponCode ?? '') ?? null),
    })),
    settledCents,
    pendingCents,
  };
}
