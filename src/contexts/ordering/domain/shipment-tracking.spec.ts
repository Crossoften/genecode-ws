import { OrderStatus } from './order-status';
import { forwardPath, simulatedEvents, targetStatusFor } from './shipment-tracking';

const event = (code: string) => ({ at: new Date(), code, description: code, location: null });

/** GC-AJ-040: os eventos da DHL movem o pedido, sempre para frente. */
describe('rastreio → esteira do pedido', () => {
  it('ida: coletado vira "kit enviado"; entregue vira "kit entregue"', () => {
    expect(targetStatusFor('OUTBOUND', [event('SD'), event('PU')])).toBe(OrderStatus.KIT_SHIPPED);
    expect(targetStatusFor('OUTBOUND', [event('PU'), event('WC'), event('OK')])).toBe(
      OrderStatus.KIT_DELIVERED,
    );
  });

  it('volta: coletada vira "amostra a caminho"; entregue vira "amostra recebida"', () => {
    expect(targetStatusFor('INBOUND', [event('PU')])).toBe(OrderStatus.SAMPLE_IN_TRANSIT);
    expect(targetStatusFor('INBOUND', [event('PU'), event('OK')])).toBe(OrderStatus.SAMPLE_RECEIVED);
  });

  it('evento só de dados ou de exceção não move nada', () => {
    expect(targetStatusFor('OUTBOUND', [event('SD')])).toBeNull();
    expect(targetStatusFor('INBOUND', [event('NH')])).toBeNull();
  });

  it('anda um estado por vez pela máquina de estados', () => {
    expect(forwardPath(OrderStatus.PAID, OrderStatus.SAMPLE_IN_TRANSIT)).toEqual([
      OrderStatus.KIT_SHIPPED,
      OrderStatus.KIT_DELIVERED,
      OrderStatus.SAMPLE_IN_TRANSIT,
    ]);
  });

  it('nunca volta, nem sai de cancelado', () => {
    expect(forwardPath(OrderStatus.SAMPLE_RECEIVED, OrderStatus.KIT_DELIVERED)).toEqual([]);
    expect(forwardPath(OrderStatus.CANCELLED, OrderStatus.KIT_SHIPPED)).toEqual([]);
  });
});

/** GC-AJ-042: a simulação da ida e da volta anda com o relógio. */
describe('rastreio simulado', () => {
  const created = new Date('2026-11-03T10:00:00Z');

  it('a ida começa na etiqueta e chega a "entregue" em quatro etapas', () => {
    const events = simulatedEvents(
      { reverse: false, createdAt: created, pickupAt: null },
      new Date(created.getTime() + 16 * 60_000),
      5,
    );
    expect(events.map((e) => e.code)).toEqual(['PU', 'AF', 'WC', 'OK']);
  });

  it('a volta parte do pedido de retirada, não do dia agendado', () => {
    const now = new Date(created.getTime() + 60 * 60_000);
    const pedida = new Date(now.getTime() - 11 * 60_000);
    const amanha = new Date(now.getTime() + 24 * 60 * 60_000);
    expect(
      simulatedEvents(
        { reverse: true, createdAt: created, pickupAt: amanha, pickupRequestedAt: pedida },
        now,
        5,
      ).map((e) => e.code),
    ).toEqual(['PU', 'AF', 'WC']);
  });

  it('a volta só anda depois da coleta agendada', () => {
    const now = new Date(created.getTime() + 60 * 60_000);
    expect(simulatedEvents({ reverse: true, createdAt: created, pickupAt: null }, now, 5)).toEqual([]);
    const pickupAt = new Date(now.getTime() - 6 * 60_000);
    expect(
      simulatedEvents({ reverse: true, createdAt: created, pickupAt }, now, 5).map((e) => e.code),
    ).toEqual(['PU', 'AF']);
  });
});
