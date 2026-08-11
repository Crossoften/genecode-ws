import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

import { TRIGGER_FUNNEL_ORDER, toTriggerView, type TriggerView } from '../notification-trigger.view';

export interface NotificationKpis {
  /** Every send attempt logged in the current calendar month, any status. */
  readonly sentThisMonth: number;
  /**
   * DELIVERED / (SENT + DELIVERED + FAILED), as a percentage with one decimal.
   *
   * `null` when there are no logs at all — the panel shows an em dash instead
   * of a misleading 0% or 100%.
   */
  readonly deliveryRate: number | null;
  readonly activeCount: number;
  readonly totalCount: number;
}

export interface NotificationPanel {
  readonly triggers: readonly TriggerView[];
  readonly kpis: NotificationKpis;
}

/**
 * Assembles the admin notifications screen: the five trigger cards in funnel
 * order plus the messaging KPIs.
 */
@Injectable()
export class ListNotificationTriggersUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the trigger list and KPIs consumed by the notifications screen. */
  async execute(): Promise<NotificationPanel> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [rows, sentThisMonth, byStatus] = await Promise.all([
      this.prisma.notificationTrigger.findMany(),
      this.prisma.notificationLog.count({ where: { createdAt: { gte: monthStart } } }),
      this.prisma.notificationLog.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const triggers = [...rows]
      .sort(
        (a, b) => TRIGGER_FUNNEL_ORDER.indexOf(a.key) - TRIGGER_FUNNEL_ORDER.indexOf(b.key),
      )
      .map(toTriggerView);

    const totalLogs = byStatus.reduce((sum, group) => sum + group._count._all, 0);
    const delivered = byStatus.find((group) => group.status === 'DELIVERED')?._count._all ?? 0;
    const failed = byStatus.find((group) => group.status === 'FAILED')?._count._all ?? 0;
    // Enquanto só existirem logs SENT (sender de log, sem operadora), não há
    // taxa de entrega a calcular — 0% seria mentira, não medição.
    const hasDeliveryData = delivered + failed > 0;

    return {
      triggers,
      kpis: {
        sentThisMonth,
        deliveryRate: hasDeliveryData
          ? Math.round((delivered / totalLogs) * 1000) / 10
          : null,
        activeCount: triggers.filter((trigger) => trigger.enabled).length,
        totalCount: triggers.length,
      },
    };
  }
}
