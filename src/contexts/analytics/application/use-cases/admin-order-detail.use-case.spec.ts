import { OrderStatus } from '@contexts/ordering/domain/order-status';
import type { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';

import { AdminOrderDetailUseCase } from './admin-order-detail.use-case';

/**
 * A ficha 360° repete duas regras que não podem divergir de outros pontos do
 * sistema: a previsão de laudo do acompanhamento do paciente e o split
 * total−comissão em centavos inteiros. Os testes fixam as duas.
 */
describe('AdminOrderDetailUseCase', () => {
  const DAY_MS = 86_400_000;
  const SAMPLE_AT = new Date(2026, 5, 19);

  function orderRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'pedido-1',
      number: 'GC-2026-50890',
      status: OrderStatus.SAMPLE_RECEIVED,
      customerName: 'Helena Vasconcelos',
      customerEmail: 'helena.v@email.com',
      customerDoc: '312.448.190-55',
      customerPhone: '+5511988214470',
      subtotalCents: 34_900,
      discountCents: 3_490,
      shippingCents: 2_490,
      totalCents: 33_899,
      couponCode: 'PARCEIRO10',
      commissionCents: 5_235,
      outboundTracking: 'BR8841220PA',
      inboundTracking: null,
      createdAt: new Date(2026, 5, 15),
      paidAt: new Date(2026, 5, 15, 10),
      address: null,
      items: [],
      payments: [],
      events: [
        { status: OrderStatus.PAID, note: null, actor: 'system', createdAt: new Date(2026, 5, 15) },
        { status: OrderStatus.SAMPLE_RECEIVED, note: null, actor: 'system', createdAt: SAMPLE_AT },
      ],
      ...overrides,
    };
  }

  function buildPrisma(order: ReturnType<typeof orderRow> | null, partnerName: string | null = 'Marina Costa') {
    return {
      order: {
        findUnique: jest.fn(async ({ where }: { where: { number: string } }) =>
          order !== null && where.number === order.number ? order : null,
        ),
      },
      kit: {
        findFirst: jest.fn(async () => null),
      },
      coupon: {
        findUnique: jest.fn(async () => ({ partnerName })),
      },
    };
  }

  const useCase = (prisma: ReturnType<typeof buildPrisma>) =>
    new AdminOrderDetailUseCase(prisma as unknown as PrismaService);

  it('devolve 404 uniforme para pedido inexistente', async () => {
    const prisma = buildPrisma(null);

    const result = await useCase(prisma).execute('GC-0000-00000');

    expect(result.isFail()).toBe(true);
    if (result.isFail()) {
      expect(result.error).toBeInstanceOf(NotFoundError);
      expect(result.error.message).toBe('Pedido não encontrado.');
    }
  });

  it('normaliza o número antes de buscar, como o acompanhamento público', async () => {
    const prisma = buildPrisma(orderRow());

    const result = await useCase(prisma).execute('  gc-2026-50890 ');

    expect(result.isOk()).toBe(true);
    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ number: 'GC-2026-50890' }) }),
    );
  });

  it('estima o laudo em SAMPLE_RECEIVED + 15 dias enquanto não há laudo', async () => {
    const prisma = buildPrisma(orderRow());

    const result = await useCase(prisma).execute('GC-2026-50890');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.estimatedReportAt).toEqual(new Date(SAMPLE_AT.getTime() + 15 * DAY_MS));
    }
  });

  it('usa o último SAMPLE_RECEIVED no reenvio de swab — a contagem reinicia', async () => {
    const resent = new Date(SAMPLE_AT.getTime() + 10 * DAY_MS);
    const prisma = buildPrisma(
      orderRow({
        events: [
          { status: OrderStatus.SAMPLE_RECEIVED, note: null, actor: 'system', createdAt: SAMPLE_AT },
          { status: OrderStatus.SAMPLE_IN_TRANSIT, note: null, actor: 'system', createdAt: new Date(SAMPLE_AT.getTime() + 2 * DAY_MS) },
          { status: OrderStatus.SAMPLE_RECEIVED, note: null, actor: 'system', createdAt: resent },
        ],
      }),
    );

    const result = await useCase(prisma).execute('GC-2026-50890');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.estimatedReportAt).toEqual(new Date(resent.getTime() + 15 * DAY_MS));
    }
  });

  it('não estima laudo quando o pedido já chegou a REPORT_READY', async () => {
    const prisma = buildPrisma(orderRow({ status: OrderStatus.REPORT_READY }));

    const result = await useCase(prisma).execute('GC-2026-50890');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.estimatedReportAt).toBeNull();
  });

  it('não estima laudo antes de a amostra chegar ao laboratório', async () => {
    const prisma = buildPrisma(
      orderRow({
        status: OrderStatus.KIT_SHIPPED,
        events: [
          { status: OrderStatus.PAID, note: null, actor: 'system', createdAt: new Date(2026, 5, 15) },
        ],
      }),
    );

    const result = await useCase(prisma).execute('GC-2026-50890');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.estimatedReportAt).toBeNull();
  });

  it('divide o pagamento em centavos inteiros: parceiro = comissão, GeneCode = resto', async () => {
    const prisma = buildPrisma(orderRow());

    const result = await useCase(prisma).execute('GC-2026-50890');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.split).toEqual({ geneCodeCents: 28_664, partnerCents: 5_235 });
      expect(result.value.partnerName).toBe('Marina Costa');
    }
  });

  it('sem cupom, o split é todo da GeneCode e não consulta cupom', async () => {
    const prisma = buildPrisma(orderRow({ couponCode: null, commissionCents: null }));

    const result = await useCase(prisma).execute('GC-2026-50890');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.split).toEqual({ geneCodeCents: 33_899, partnerCents: 0 });
      expect(result.value.partnerName).toBeNull();
    }
    expect(prisma.coupon.findUnique).not.toHaveBeenCalled();
  });

  it('expõe as transições permitidas direto da máquina de estados', async () => {
    const prisma = buildPrisma(orderRow());

    const result = await useCase(prisma).execute('GC-2026-50890');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.allowedTransitions).toEqual([
        OrderStatus.PROCESSING,
        OrderStatus.SAMPLE_IN_TRANSIT,
      ]);
    }
  });
});
