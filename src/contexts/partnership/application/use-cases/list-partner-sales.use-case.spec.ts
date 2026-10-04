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
      couponCode: 'MARINA10',
      items: [{ productName: 'gene.code Completo' }],
      ...overrides,
    };
  }

  const ORDERS = [
    orderRow('pedido-1', 'GC-2026-00001'),
    orderRow('pedido-2', 'GC-2026-00002'),
    orderRow('pedido-3', 'GC-2026-00003'),
  ];

  const PAYOUTS = [
    { orderId: 'pedido-1', status: 'SETTLED', amountCents: 5_235, level: 1 },
    { orderId: 'pedido-2', status: 'PENDING', amountCents: 5_235, level: 1 },
    // pedido-3 sem repasse: status derivado NOT_ISSUED.
  ];

  /** Parceiros da rede, para resolver o nome de quem vendeu. */
  const DA_REDE = [{ couponCode: 'VENDEDOR20', displayName: 'Vendedor da Unidade' }];

  function buildPrisma(
    partner: typeof PARTNER | null = PARTNER,
    orders = ORDERS,
    payouts = PAYOUTS,
    daRede = DA_REDE,
  ) {
    return {
      partner: {
        findUnique: jest.fn(async () => partner),
        findMany: jest.fn(async () => daRede),
      },
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
      // Lista branca: só o que o parceiro pode ver. `vendidoPor` é o nome do
      // parceiro da rede que fez a venda — nunca o do comprador.
      expect(Object.keys(result.value.sales[0] ?? {}).sort()).toEqual([
        'amountCents',
        'commissionCents',
        'date',
        'level',
        'orderNumber',
        'origem',
        'payoutStatus',
        'productName',
        'vendidoPor',
      ]);
    }
  });

  it('devolve 404 para usuário sem perfil de parceiro', async () => {
    const result = await useCase(buildPrisma(null)).execute('user-x');

    expect(result.isFail()).toBe(true);
    if (result.isFail()) expect(result.error).toBeInstanceOf(NotFoundError);
  });

  describe('vendas da rede', () => {
    it('mostra a venda feita por quem está abaixo, com a MINHA fatia', async () => {
      // Pedido com o cupom do vendedor, e repasse de nível 1 para mim: numa
      // venda da rede o pedido gera 20% de bolo e a raiz leva 7.
      const daRede = orderRow('pedido-rede', 'GC-2026-00099', {
        couponCode: 'VENDEDOR20',
        commissionCents: 12_096,
      });
      const prisma = buildPrisma(
        PARTNER,
        [daRede],
        [{ orderId: 'pedido-rede', status: 'PENDING', amountCents: 4_233, level: 1 }],
      );

      const result = await useCase(prisma).execute('user-1');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const venda = result.value.sales[0];
        // A fatia do parceiro, não a comissão do pedido.
        expect(venda.commissionCents).toBe(4_233);
        expect(venda.origem).toBe('REDE');
        expect(venda.vendidoPor).toBe('Vendedor da Unidade');
        expect(venda.level).toBe(1);
      }
    });

    it('venda do próprio cupom é PROPRIA e não nomeia vendedor', async () => {
      const result = await useCase(buildPrisma()).execute('user-1');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.sales.every((v) => v.origem === 'PROPRIA')).toBe(true);
        expect(result.value.sales.every((v) => v.vendidoPor === null)).toBe(true);
      }
    });

    it('a venda da rede também não expõe o comprador', async () => {
      const daRede = orderRow('pedido-rede', 'GC-2026-00099', { couponCode: 'VENDEDOR20' });
      const prisma = buildPrisma(
        PARTNER,
        [daRede],
        [{ orderId: 'pedido-rede', status: 'PENDING', amountCents: 4_233, level: 1 }],
      );

      const result = await useCase(prisma).execute('user-1');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const serializado = JSON.stringify(result.value.sales);
        expect(serializado).not.toContain('Helena');
        expect(serializado).not.toContain('helena.v@email.com');
        expect(serializado).not.toContain('312.448.190-55');
      }
    });
  });
});
