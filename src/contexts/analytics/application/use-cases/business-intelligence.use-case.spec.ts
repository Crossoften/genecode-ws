import type { PrismaService } from '@infra/database/prisma.service';

import { BusinessIntelligenceUseCase } from './business-intelligence.use-case';

/**
 * O BI de vendas compara a janela atual com a mesma janela deslocada para trás
 * e desenha as séries semanal e mensal. Errar a borda da janela anterior faz o
 * delta do painel mentir — o teste fixa `now` e verifica as datas exatas que
 * chegam ao banco, além das somas.
 */
describe('BusinessIntelligenceUseCase — sales', () => {
  const DAY_MS = 86_400_000;
  const NOW = new Date(2026, 7, 10, 12, 0, 0);

  interface CurrentRow {
    paidAt: Date | null;
    totalCents: number;
    commissionCents: number | null;
    couponCode: string | null;
    address: { state: string } | null;
  }

  interface MoneyRow {
    paidAt?: Date;
    totalCents: number;
    commissionCents: number | null;
  }

  function currentRow(paidAt: Date | null, totalCents = 10_000): CurrentRow {
    return { paidAt, totalCents, commissionCents: 0, couponCode: null, address: null };
  }

  function buildPrisma(rows: {
    current?: CurrentRow[];
    previous?: MoneyRow[];
    monthly?: MoneyRow[];
  }) {
    const findMany = jest.fn(
      async (args: {
        where: {
          createdAt?: { gte: Date; lt?: Date };
          paidAt?: { gte?: Date; not?: null };
        };
      }) => {
        if (args.where.paidAt?.gte) return rows.monthly ?? [];
        if (args.where.createdAt?.lt) return rows.previous ?? [];
        return rows.current ?? [];
      },
    );
    return { order: { findMany } };
  }

  const useCase = (prisma: ReturnType<typeof buildPrisma>) =>
    new BusinessIntelligenceUseCase(prisma as unknown as PrismaService);

  it('consulta o período anterior como a mesma janela deslocada para trás', async () => {
    const prisma = buildPrisma({});

    await useCase(prisma).sales(30, NOW);

    const previousCall = prisma.order.findMany.mock.calls
      .map(([args]) => args)
      .find((args) => args.where.createdAt?.lt !== undefined);

    expect(previousCall).toBeDefined();
    expect(previousCall!.where.createdAt!.gte).toEqual(new Date(NOW.getTime() - 60 * DAY_MS));
    expect(previousCall!.where.createdAt!.lt).toEqual(new Date(NOW.getTime() - 30 * DAY_MS));
    expect(previousCall!.where.paidAt).toEqual({ not: null });
  });

  it('soma o período anterior tratando comissão nula como zero', async () => {
    const prisma = buildPrisma({
      previous: [
        { totalCents: 10_000, commissionCents: 1_500 },
        { totalCents: 20_000, commissionCents: null },
      ],
    });

    const metrics = await useCase(prisma).sales(30, NOW);

    expect(metrics.previousPeriod).toEqual({
      ordersPaid: 2,
      grossRevenueCents: 30_000,
      netRevenueCents: 28_500,
    });
  });

  it('agrupa as vendas pagas nas semanas da janela, S1 a mais antiga', async () => {
    const prisma = buildPrisma({
      current: [
        currentRow(new Date(NOW.getTime() - 13 * DAY_MS), 5_000),
        currentRow(new Date(NOW.getTime() - 2 * DAY_MS), 7_000),
        currentRow(new Date(NOW.getTime() - 1 * DAY_MS), 3_000),
        // Nunca pago: não pode aparecer no gráfico de vendas.
        currentRow(null, 99_000),
      ],
    });

    const metrics = await useCase(prisma).sales(14, NOW);

    expect(metrics.weeklySales).toEqual([
      { week: 'S1', count: 1, revenueCents: 5_000 },
      { week: 'S2', count: 2, revenueCents: 10_000 },
    ]);
  });

  it('dimensiona as semanas pelo teto da janela — 30 dias viram 5 semanas', async () => {
    const prisma = buildPrisma({});

    const metrics = await useCase(prisma).sales(30, NOW);

    expect(metrics.weeklySales.map((entry) => entry.week)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
    ]);
  });

  it('monta a série mensal dos últimos 6 meses, independente da janela', async () => {
    const prisma = buildPrisma({
      monthly: [
        { paidAt: new Date(2026, 2, 2), totalCents: 1_000, commissionCents: 100 },
        { paidAt: new Date(2026, 6, 15), totalCents: 5_000, commissionCents: 500 },
        { paidAt: new Date(2026, 7, 1), totalCents: 7_000, commissionCents: null },
      ],
    });

    const metrics = await useCase(prisma).sales(7, NOW);

    expect(metrics.monthlySeries).toEqual([
      { month: 'Mar', revenueCents: 1_000, commissionCents: 100 },
      { month: 'Abr', revenueCents: 0, commissionCents: 0 },
      { month: 'Mai', revenueCents: 0, commissionCents: 0 },
      { month: 'Jun', revenueCents: 0, commissionCents: 0 },
      { month: 'Jul', revenueCents: 5_000, commissionCents: 500 },
      { month: 'Ago', revenueCents: 7_000, commissionCents: 0 },
    ]);

    const monthlyCall = prisma.order.findMany.mock.calls
      .map(([args]) => args)
      .find((args) => args.where.paidAt?.gte !== undefined);
    expect(monthlyCall!.where.paidAt!.gte).toEqual(new Date(2026, 2, 1));
  });
});
