import type { PrismaService } from '@infra/database/prisma.service';

import { ListNotificationTriggersUseCase } from './list-notification-triggers.use-case';

/**
 * O ponto sensível é o KPI de taxa de entrega: sem nenhum log, 0/0 não pode
 * virar 0% (leitura de "nada chega") nem 100% (leitura de "tudo chega") — o
 * contrato é `null` e o front mostra "—".
 */
describe('ListNotificationTriggersUseCase — deliveryRate', () => {
  const triggerRow = (key: string, enabled = true) => ({
    id: `id-${key}`,
    key,
    enabled,
    template: 'Olá {nome}!',
    channelWhatsapp: true,
    channelEmail: true,
    channelSms: false,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
  });

  function buildPrisma(
    logsByStatus: Record<string, number>,
    sentThisMonth = 0,
    rows: ReturnType<typeof triggerRow>[] = [
      triggerRow('REPORT_READY'),
      triggerRow('ORDER_CONFIRMED'),
      triggerRow('REMINDER', false),
    ],
  ) {
    return {
      notificationTrigger: { findMany: jest.fn(async () => rows) },
      notificationLog: {
        count: jest.fn(async () => sentThisMonth),
        groupBy: jest.fn(async () =>
          Object.entries(logsByStatus).map(([status, total]) => ({
            status,
            _count: { _all: total },
          })),
        ),
      },
    };
  }

  const useCase = (prisma: ReturnType<typeof buildPrisma>) =>
    new ListNotificationTriggersUseCase(prisma as unknown as PrismaService);

  it('devolve null quando não há nenhum log', async () => {
    const panel = await useCase(buildPrisma({})).execute();

    expect(panel.kpis.deliveryRate).toBeNull();
    expect(panel.kpis.sentThisMonth).toBe(0);
  });

  it('calcula o percentual sobre SENT+DELIVERED+FAILED com uma casa decimal', async () => {
    // 964 entregues em 1000 tentativas → 96.4%.
    const panel = await useCase(buildPrisma({ DELIVERED: 964, SENT: 26, FAILED: 10 }, 1000)).execute();

    expect(panel.kpis.deliveryRate).toBe(96.4);
    expect(panel.kpis.sentThisMonth).toBe(1000);
  });

  it('ordena os gatilhos pelo funil e conta ativos/total', async () => {
    const panel = await useCase(buildPrisma({ DELIVERED: 1 })).execute();

    expect(panel.triggers.map((t) => t.key)).toEqual([
      'ORDER_CONFIRMED',
      'REMINDER',
      'REPORT_READY',
    ]);
    expect(panel.kpis.activeCount).toBe(2);
    expect(panel.kpis.totalCount).toBe(3);
  });
});
