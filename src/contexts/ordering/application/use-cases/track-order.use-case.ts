import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { OrderStatus, STATUS_LABEL, TIMELINE } from '../../domain/order-status';

export interface TimelineStep {
  readonly status: OrderStatus;
  readonly label: string;
  readonly reachedAt: Date | null;
  readonly current: boolean;
}

export interface OrderTracking {
  readonly number: string;
  /** Só o primeiro nome — a rota é pública por número do pedido. */
  readonly customerFirstName: string;
  readonly status: OrderStatus;
  readonly statusLabel: string;
  readonly items: readonly { readonly name: string; readonly quantity: number }[];
  readonly outboundTracking: string | null;
  readonly inboundTracking: string | null;
  readonly timeline: readonly TimelineStep[];
}

/**
 * Linha do tempo do pedido, para o cliente acompanhar.
 *
 * Devolve **apenas** o primeiro nome do comprador, nunca CPF, e-mail, endereço
 * ou valor. A rota é pública por número do pedido — quem comprou sem conta
 * precisa acompanhar — e um número de pedido vazado não pode virar vazamento de
 * dado pessoal.
 */
@Injectable()
export class TrackOrderUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(orderNumber: string): Promise<Result<OrderTracking>> {
    const order = await this.prisma.order.findUnique({
      where: { number: orderNumber.trim().toUpperCase() },
      include: {
        items: true,
        events: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!order) return fail(new NotFoundError('Pedido não encontrado.'));

    const reachedAt = new Map(
      order.events.map((event) => [event.status as OrderStatus, event.createdAt]),
    );
    const status = order.status as OrderStatus;

    return ok({
      number: order.number,
      customerFirstName: order.customerName.split(' ')[0] ?? '',
      status,
      statusLabel: STATUS_LABEL[status],
      items: order.items.map((item) => ({ name: item.productName, quantity: item.quantity })),
      outboundTracking: order.outboundTracking,
      inboundTracking: order.inboundTracking,
      timeline: TIMELINE.map((step) => ({
        status: step,
        label: STATUS_LABEL[step],
        reachedAt: reachedAt.get(step) ?? null,
        current: step === status,
      })),
    });
  }
}
