import { Injectable } from '@nestjs/common';
import type { NotificationTriggerKey } from '@prisma/client';

import { PrismaService } from '@infra/database/prisma.service';

import { OrderStatus, STATUS_LABEL } from '../../domain/order-status';

/** Etapa do feed: um status de pedido, ou o aviso avulso "Análise em andamento". */
export type FeedStatus = OrderStatus | 'ANALYSIS_IN_PROGRESS';

export interface FeedEntry {
  readonly orderNumber: string;
  readonly productName: string | null;
  readonly status: FeedStatus;
  readonly label: string;
  /**
   * A mensagem como o cliente a escreveu (GC-AJ-025), com o primeiro nome da
   * pessoa — o mesmo texto do gatilho de notificação daquela etapa, inclusive
   * o que o admin tiver editado. Null onde não há texto do cliente; aí o
   * front usa a frase curta da tela.
   */
  readonly message: string | null;
  readonly createdAt: Date;
}

/** Quantos eventos o feed devolve — o painel mostra só os últimos. */
const FEED_SIZE = 20;

/**
 * Gatilho cujo texto vira a mensagem de cada etapa. Só as etapas com texto do
 * cliente: o "Kit enviado" leva `{link_rastreio}`, que o feed não tem como
 * preencher, e fica com a frase da tela.
 */
const TRIGGER_BY_STATUS: Partial<Record<FeedStatus, NotificationTriggerKey>> = {
  [OrderStatus.PAID]: 'ORDER_CONFIRMED',
  [OrderStatus.SAMPLE_RECEIVED]: 'SAMPLE_RECEIVED',
  [OrderStatus.PROCESSING]: 'ANALYSIS_STARTED',
  ANALYSIS_IN_PROGRESS: 'ANALYSIS_IN_PROGRESS',
  [OrderStatus.REPORT_READY]: 'REPORT_READY',
};

/**
 * Feed "Atualizações recentes" / "Mensagens enviadas" da área do paciente.
 *
 * Um único GET com os eventos dos pedidos da conta, em vez de o front chamar o
 * acompanhamento público de cada pedido (N+1) e recompor a história. Junta os
 * eventos de `order_events` com o aviso "Análise em andamento", que não é uma
 * troca de status e só existe em `notification_logs` (GC-AJ-024).
 */
@Injectable()
export class AccountFeedUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(userId: string): Promise<FeedEntry[]> {
    const orderSelect = {
      number: true,
      items: { select: { productName: true }, take: 1 },
    } as const;

    const [user, events, triggers] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      this.prisma.orderEvent.findMany({
        where: { order: { userId } },
        orderBy: { createdAt: 'desc' },
        take: FEED_SIZE,
        select: { status: true, createdAt: true, order: { select: orderSelect } },
      }),
      this.prisma.notificationTrigger.findMany({ select: { key: true, template: true } }),
    ]);

    const orders = await this.prisma.order.findMany({
      where: { userId },
      select: { id: true, ...orderSelect },
    });
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const inProgress =
      orders.length === 0
        ? []
        : await this.prisma.notificationLog.findMany({
            where: { orderId: { in: [...orderById.keys()] }, triggerKey: 'ANALYSIS_IN_PROGRESS' },
            orderBy: { createdAt: 'asc' },
            select: { orderId: true, createdAt: true },
          });

    const firstName = (user?.name ?? '').trim().split(/\s+/)[0] ?? '';
    const templateOf = new Map(triggers.map((trigger) => [trigger.key, trigger.template]));
    const messageFor = (status: FeedStatus, orderNumber: string): string | null => {
      const key = TRIGGER_BY_STATUS[status];
      const template = key ? templateOf.get(key) : undefined;
      if (!template) return null;
      return template
        .replaceAll('{nome}', firstName || 'tudo bem')
        .replaceAll('{pedido}', orderNumber);
    };

    const entries: FeedEntry[] = events.map((event) => {
      const status = event.status as OrderStatus;
      return {
        orderNumber: event.order.number,
        productName: event.order.items[0]?.productName ?? null,
        status,
        label: STATUS_LABEL[status],
        message: messageFor(status, event.order.number),
        createdAt: event.createdAt,
      };
    });

    // Um aviso por pedido basta — reenviar não é uma etapa nova.
    const seen = new Set<string>();
    for (const log of inProgress) {
      if (!log.orderId || seen.has(log.orderId)) continue;
      seen.add(log.orderId);
      const order = orderById.get(log.orderId);
      if (!order) continue;
      entries.push({
        orderNumber: order.number,
        productName: order.items[0]?.productName ?? null,
        status: 'ANALYSIS_IN_PROGRESS',
        label: 'Análise em andamento',
        message: messageFor('ANALYSIS_IN_PROGRESS', order.number),
        createdAt: log.createdAt,
      });
    }

    return entries
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, FEED_SIZE);
  }
}
