import type { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';

import { ListPartnerSalesUseCase } from './list-partner-sales.use-case';

/**
 * A lista completa repete duas regras que não podem escorregar: o filtro de
 * repasse opera sobre o status derivado (incluindo NOT_ISSUED) sem mexer nos
 * agregados, e a linha nunca carrega dado pessoal do comprador.
 */
describe('ListPartnerSalesUseCase', () => {
  const PARTNER = { id: 'parceiro-1', userId: 'user-1', couponCode: 'MARINA10' };

  function orderRow(id: string, number: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      number,
      totalCents: 34_900,
      commissionCents: 5_235,
      createdAt: new Date(2026, 6, 10),
      // Campos que existem no pedido mas NUNCA podem vazar para o parceiro.
      customerName: 'Helena Vasconcelos',
      customerEmail: 'helena.v@email.com',
      customerDoc: '312.448.190-55',
      items: [{ productName: 'GeneCode Completo' }],
      ...overrides,
    };
  }

  const ORDERS = [
    orderRow('pedido-1', 'GC-2026-00001'),
    orderRow('pedido-2', 'GC-2026-00002'),
    orderRow('pedido-3', 'GC-2026-00003'),
  ];

  const PAYOUTS = [
    { orderId: 'pedido-1', status: 'SETTLED', amountCents: 5_235 },
    { orderId: 'pedido-2', status: 'PENDING', amountCents: 5_235 },
    // pedido-3 sem repasse: status derivado NOT_ISSUED.
  ];

  function buildPrisma(partner: typeof PARTNER | null = PARTNER, orders = ORDERS, payouts = PAYOUTS) {
    return {
      partner: { findUnique: jest.fn(async () => partner) },
      order: { findMany: jest.fn(async () => orders) },
      payout: { findMany: jest.fn(async () => payouts) },
    };
  }

  const useCase = (prisma: ReturnType<typeof buildPrisma>) =>
    new ListPartnerSalesUseCase(prisma as unknown as PrismaService);

  it('sem filtro devolve todas as vendas com os agregados', async () => {
    const result = await useCase(buildPrisma()).execute('user-1');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.sales).toHaveLength(3);
      expect(result.value.totalCount).toBe(3);
      expect(result.value.settledCents).toBe(5_235);
      expect(result.value.pendingCents).toBe(5_235);
    }
  });

  it('filtra por um status de repasse sem alterar os agregados', async () => {
    const result = await useCase(buildPrisma()).execute('user-1', ['SETTLED']);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.sales.map((sale) => sale.orderNumber)).toEqual(['GC-2026-00001']);
      // Os cartões-resumo não acompanham os chips: continuam globais.
      expect(result.value.totalCount).toBe(3);
      expect(result.value.settledCents).toBe(5_235);
      expect(result.value.pendingCents).toBe(5_235);
    }
  });

  it('aceita CSV com mais de um status', async () => {
    const result = await useCase(buildPrisma()).execute('user-1', ['PENDING', 'NOT_ISSUED']);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.sales.map((sale) => sale.orderNumber)).toEqual([
        'GC-2026-00002',
        'GC-2026-00003',
      ]);
    }
  });

  it('filtra NOT_ISSUED: venda paga sem registro de repasse', async () => {
    const result = await useCase(buildPrisma()).execute('user-1', ['NOT_ISSUED']);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.sales.map((sale) => sale.orderNumber)).toEqual(['GC-2026-00003']);
      expect(result.value.sales[0]?.payoutStatus).toBe('NOT_ISSUED');
    }
  });

  it('descarta valores desconhecidos do filtro, como os chips do admin', async () => {
    const result = await useCase(buildPrisma()).execute('user-1', ['FOO', 'BAR']);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.sales).toHaveLength(3);
  });

  it('nunca expõe dados pessoais do comprador na linha de venda', async () => {
    const result = await useCase(buildPrisma()).execute('user-1');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(Object.keys(result.value.sales[0] ?? {}).sort()).toEqual([
        'amountCents',
        'commissionCents',
        'date',
        'orderNumber',
        'payoutStatus',
        'productName',
      ]);
    }
  });

  it('devolve 404 para usuário sem perfil de parceiro', async () => {
    const result = await useCase(buildPrisma(null)).execute('user-x');

    expect(result.isFail()).toBe(true);
    if (result.isFail()) expect(result.error).toBeInstanceOf(NotFoundError);
  });
});
