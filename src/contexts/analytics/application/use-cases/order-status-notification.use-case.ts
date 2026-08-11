import { Injectable } from '@nestjs/common';
import type { NotificationChannel, NotificationTriggerKey } from '@prisma/client';

import { OrderStatus } from '@contexts/ordering/domain/order-status';
import { PrismaService } from '@infra/database/prisma.service';

export interface NotifiableOrder {
  readonly id: string;
  readonly customerEmail: string;
  readonly customerPhone: string | null;
}

export interface DispatchedNotification {
  readonly channel: NotificationChannel;
  readonly recipient: string;
}

/**
 * Which trigger fires when the order lands on each status. Statuses outside
 * this map change silently: internal hops (KIT_DELIVERED, PROCESSING…) are not
 * moments the patient asked to hear about.
 */
const TRIGGER_BY_STATUS: Partial<Record<OrderStatus, NotificationTriggerKey>> = {
  [OrderStatus.PAID]: 'ORDER_CONFIRMED',
  [OrderStatus.KIT_SHIPPED]: 'KIT_SHIPPED',
  [OrderStatus.SAMPLE_RECEIVED]: 'SAMPLE_RECEIVED',
  [OrderStatus.REPORT_READY]: 'REPORT_READY',
};

/**
 * Records the patient notifications owed by an order status change.
 *
 * Nothing actually leaves the platform — the messaging operator is not hired
 * yet. The `NotificationLog` row IS the dispatch: it is what the admin panel
 * audits and what the real sender will replay from when it exists.
 */
@Injectable()
export class OrderStatusNotificationUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Logs one notification per resolved channel for the given status change.
   *
   * @param order - Order already moved to `status`.
   * @param status - Status the order just landed on.
   * @param channels - Explicit channels chosen in the admin modal; when absent
   * the trigger's default channels apply.
   * @returns The dispatches recorded, empty when the status has no trigger,
   * the trigger is disabled, or no channel has a recipient.
   */
  async execute(
    order: NotifiableOrder,
    status: OrderStatus,
    channels?: readonly NotificationChannel[],
  ): Promise<readonly DispatchedNotification[]> {
    const triggerKey = TRIGGER_BY_STATUS[status];
    if (!triggerKey) return [];

    const trigger = await this.prisma.notificationTrigger.findUnique({
      where: { key: triggerKey },
    });
    if (!trigger || !trigger.enabled) return [];

    const resolved = [...new Set(channels ?? defaultChannels(trigger))];

    const dispatches: DispatchedNotification[] = [];
    for (const channel of resolved) {
      const recipient = channel === 'EMAIL' ? order.customerEmail : order.customerPhone;
      // Sem telefone não há WhatsApp/SMS — pular é melhor que logar envio falso.
      if (!recipient) continue;
      dispatches.push({ channel, recipient });
    }

    if (dispatches.length > 0) {
      await this.prisma.notificationLog.createMany({
        data: dispatches.map((dispatch) => ({
          triggerKey,
          channel: dispatch.channel,
          recipient: dispatch.recipient,
          orderId: order.id,
          status: 'SENT' as const,
        })),
      });
    }

    return dispatches;
  }
}

function defaultChannels(trigger: {
  channelWhatsapp: boolean;
  channelEmail: boolean;
  channelSms: boolean;
}): NotificationChannel[] {
  const channels: NotificationChannel[] = [];
  if (trigger.channelWhatsapp) channels.push('WHATSAPP');
  if (trigger.channelEmail) channels.push('EMAIL');
  if (trigger.channelSms) channels.push('SMS');
  return channels;
}
