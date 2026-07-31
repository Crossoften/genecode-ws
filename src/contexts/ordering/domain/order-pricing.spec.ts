import {
  calculateTotals,
  formatOrderNumber,
  installmentCents,
  type PricedItem,
} from './order-pricing';
import { OrderStatus, canTransition, isTerminal, nextStatuses } from './order-status';

const KIT: PricedItem = {
  productSlug: 'performance',
  productName: 'GeneCode Performance',
  unitCents: 46_800,
  quantity: 1,
};

/**
 * Aritmética do pedido.
 *
 * Cada asserção aqui corresponde a dinheiro real: erro de centavo vira comissão
 * paga a menos ao parceiro ou cobrança a maior no cartão do cliente. Por isso os
 * valores são exatos, nunca aproximados.
 */
describe('Precificação do pedido', () => {
  const FRETE = 1_980;

  it('sem cupom, o total é produtos mais frete', () => {
    const totals = calculateTotals([KIT], FRETE, null);
    expect(totals.subtotalCents).toBe(46_800);
    expect(totals.discountCents).toBe(0);
    expect(totals.totalCents).toBe(48_780);
    expect(totals.commissionCents).toBeNull();
  });

  it('o desconto incide só sobre os produtos, nunca sobre o frete', () => {
    const totals = calculateTotals([KIT], FRETE, {
      code: 'PARCEIRO10',
      discountPercent: 10,
      commissionPercent: 20,
    });

    expect(totals.discountCents).toBe(4_680);
    // Se o desconto pegasse o frete, o total seria 43 902.
    expect(totals.totalCents).toBe(44_100);
    expect(totals.shippingCents).toBe(FRETE);
  });

  it('a comissão incide sobre o valor com desconto, e não sobre o frete', () => {
    const totals = calculateTotals([KIT], FRETE, {
      code: 'PARCEIRO10',
      discountPercent: 10,
      commissionPercent: 20,
    });

    // 20% de 421,20 — não de 468,00 nem de 441,00.
    expect(totals.commissionCents).toBe(8_424);
    expect(totals.commissionRate).toBe(20);
  });

  it('soma múltiplos itens e quantidades', () => {
    const totals = calculateTotals(
      [KIT, { ...KIT, productSlug: 'nutrigenetica', unitCents: 39_700, quantity: 2 }],
      FRETE,
      null,
    );
    expect(totals.subtotalCents).toBe(46_800 + 39_700 * 2);
  });

  it('arredonda o desconto para baixo, favorecendo o cliente', () => {
    // 33% de 46 800 = 15 444 exatos; usa um valor que gera fração.
    const totals = calculateTotals([{ ...KIT, unitCents: 33_333 }], 0, {
      code: 'X',
      discountPercent: 33,
      commissionPercent: 10,
    });
    expect(totals.discountCents).toBe(10_999); // 10 999,89 truncado
  });

  it('formata o número do pedido como o protótipo aprovado', () => {
    expect(formatOrderNumber(2026, 1)).toBe('GC-2026-00001');
    expect(formatOrderNumber(2026, 12_345)).toBe('GC-2026-12345');
  });

  it('arredonda a parcela para cima, para a soma nunca ficar abaixo do total', () => {
    // 44 100 / 12 = 3 675 exatos
    expect(installmentCents(44_100, 12)).toBe(3_675);
    // 48 780 / 7 = 6 968,57 → 6 969, e 6 969 × 7 = 48 783 ≥ 48 780
    expect(installmentCents(48_780, 7) * 7).toBeGreaterThanOrEqual(48_780);
  });
});

/**
 * Máquina de estados do pedido.
 *
 * O grafo declarado é o que impede um pedido de pular etapa. Num fluxo que
 * envolve amostra biológica, saltar etapa significa perder o rastro de onde o
 * material está.
 */
describe('Máquina de estados do pedido', () => {
  it('permite a sequência normal da jornada', () => {
    const jornada = [
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.PAID,
      OrderStatus.KIT_SHIPPED,
      OrderStatus.KIT_DELIVERED,
      OrderStatus.SAMPLE_IN_TRANSIT,
      OrderStatus.SAMPLE_RECEIVED,
      OrderStatus.PROCESSING,
      OrderStatus.REPORT_READY,
    ];

    for (let i = 0; i < jornada.length - 1; i += 1) {
      expect(canTransition(jornada[i]!, jornada[i + 1]!)).toBe(true);
    }
  });

  it('recusa pular etapa', () => {
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.REPORT_READY)).toBe(false);
    expect(canTransition(OrderStatus.PAID, OrderStatus.SAMPLE_RECEIVED)).toBe(false);
    expect(canTransition(OrderStatus.KIT_SHIPPED, OrderStatus.PROCESSING)).toBe(false);
  });

  it('recusa voltar no tempo', () => {
    expect(canTransition(OrderStatus.PAID, OrderStatus.PENDING_PAYMENT)).toBe(false);
    expect(canTransition(OrderStatus.REPORT_READY, OrderStatus.PROCESSING)).toBe(false);
  });

  it('permite reenvio de swab quando a coleta falha', () => {
    // O cliente pediu métrica dessa taxa no BI, então é caso previsto.
    expect(canTransition(OrderStatus.SAMPLE_RECEIVED, OrderStatus.SAMPLE_IN_TRANSIT)).toBe(true);
    expect(canTransition(OrderStatus.PROCESSING, OrderStatus.SAMPLE_IN_TRANSIT)).toBe(true);
  });

  it('só permite cancelar antes de o kit sair', () => {
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED)).toBe(true);
    expect(canTransition(OrderStatus.PAID, OrderStatus.CANCELLED)).toBe(true);
    // Depois de despachado, o caminho é reembolso, não cancelamento.
    expect(canTransition(OrderStatus.KIT_SHIPPED, OrderStatus.CANCELLED)).toBe(false);
    expect(canTransition(OrderStatus.KIT_SHIPPED, OrderStatus.REFUNDED)).toBe(true);
  });

  it('reconhece os estados terminais', () => {
    expect(isTerminal(OrderStatus.REPORT_READY)).toBe(true);
    expect(isTerminal(OrderStatus.CANCELLED)).toBe(true);
    expect(isTerminal(OrderStatus.REFUNDED)).toBe(true);
    expect(isTerminal(OrderStatus.PAID)).toBe(false);
  });

  it('oferece ao admin só as transições válidas', () => {
    expect(nextStatuses(OrderStatus.PAID)).toEqual([
      OrderStatus.KIT_SHIPPED,
      OrderStatus.CANCELLED,
      OrderStatus.REFUNDED,
    ]);
    expect(nextStatuses(OrderStatus.REPORT_READY)).toEqual([]);
  });
});
