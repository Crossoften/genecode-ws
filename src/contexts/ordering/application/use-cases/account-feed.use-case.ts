import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

import { OrderStatus, STATUS_LABEL } from '../../domain/order-status';

export interface FeedEntry {
  readonly orderNumber: string;
  readonly productName: string | null;
  readonly status: OrderStatus;
  readonly label: string;
  readonly createdAt: Date;
}

/** Quantos eventos o feed devolve — o painel mostra só os últimos. */
const FEED_SIZE = 20;

/**
 * Feed "Atualizações recentes" da área do paciente.
 *
 * Um único GET com os eventos dos pedidos da conta, em vez de o front chamar o
 * acompanhamento público de cada pedido (N+1) e recompor a história. Leitura
 * pura de `order_events`; o texto amigável por status fica no front, junto das
 * demais strings da tela.
 */
@Injectable()
export class AccountFeedUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(userId: string): Promise<FeedEntry[]> {
    const events = await this.prisma.orderEvent.findMany({
      where: { order: { userId } },
      orderBy: { createdAt: 'desc' },
      take: FEED_SIZE,
      select: {
        status: true,
        createdAt: true,
        order: {
          select: {
            number: true,
            items: { select: { productName: true }, take: 1 },
          },
        },
      },
    });

    return events.map((event) => {
      const status = event.status as OrderStatus;
      return {
        orderNumber: event.order.number,
        productName: event.order.items[0]?.productName ?? null,
        status,
        label: STATUS_LABEL[status],
        createdAt: event.createdAt,
      };
    });
  }
}
