/**
 * Aritmética do pedido.
 *
 * Tudo em centavos inteiros. Dinheiro em ponto flutuante acumula erro — e aqui
 * o erro não fica num relatório: vira comissão paga a menos ao parceiro, ou
 * cobrança a maior no cartão do cliente.
 */

export interface PricedItem {
  readonly productSlug: string;
  readonly productName: string;
  readonly unitCents: number;
  readonly quantity: number;
}

export interface CouponTerms {
  readonly code: string;
  readonly discountPercent: number;
  readonly commissionPercent: number;
}

export interface OrderTotals {
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly totalCents: number;
  /** Comissão do parceiro, quando houve cupom. */
  readonly commissionCents: number | null;
  readonly commissionRate: number | null;
}

/**
 * Calcula os totais do pedido.
 *
 * Três decisões que mudam o valor final e são fáceis de errar:
 *
 * **O desconto incide só sobre os produtos, nunca sobre o frete.** Descontar o
 * frete significaria a GeneCode subsidiar o envio do bolso do parceiro.
 *
 * **A comissão incide sobre o valor com desconto, não sobre o cheio.** É o que
 * o parceiro efetivamente gerou de receita. Calcular sobre o cheio pagaria
 * comissão sobre dinheiro que não entrou.
 *
 * **A comissão também não incide sobre o frete**, que é repasse à
 * transportadora, não receita.
 *
 * @param items - Itens já com preço congelado.
 * @param shippingCents - Frete escolhido. O cliente paga (decisão F4).
 * @param coupon - Cupom aplicado, se houver.
 */
export function calculateTotals(
  items: readonly PricedItem[],
  shippingCents: number,
  coupon: CouponTerms | null,
): OrderTotals {
  const subtotalCents = items.reduce((sum, item) => sum + item.unitCents * item.quantity, 0);

  // Arredondamento para baixo favorece o cliente no desconto e evita cobrar um
  // centavo a mais por causa de fração.
  const discountCents = coupon
    ? Math.floor((subtotalCents * coupon.discountPercent) / 100)
    : 0;

  const productsAfterDiscount = subtotalCents - discountCents;
  const totalCents = productsAfterDiscount + shippingCents;

  const commissionCents = coupon
    ? Math.floor((productsAfterDiscount * coupon.commissionPercent) / 100)
    : null;

  return {
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents,
    commissionCents,
    commissionRate: coupon?.commissionPercent ?? null,
  };
}

/**
 * Gera o número do pedido no formato que o protótipo aprovado usa.
 *
 * @param year - Ano do pedido.
 * @param sequence - Sequencial do ano.
 */
export function formatOrderNumber(year: number, sequence: number): string {
  return `GC-${year}-${String(sequence).padStart(5, '0')}`;
}

/**
 * Valor da parcela sem juros, arredondado para cima.
 *
 * Arredondar para cima garante que a soma das parcelas nunca fique abaixo do
 * total — o contrário deixaria centavos a descoberto na última parcela.
 */
export function installmentCents(totalCents: number, installments: number): number {
  return Math.ceil(totalCents / installments);
}
