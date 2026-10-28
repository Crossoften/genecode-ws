import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import { OrderStatusNotificationUseCase } from '@contexts/analytics/application/use-cases/order-status-notification.use-case';
import { PrismaService } from '@infra/database/prisma.service';
import type { Env } from '@shared/config/env.schema';
import { ConflictError, NotFoundError, ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { OrderStatus } from '../../domain/order-status';
import {
  SHIPPING_PROVIDER,
  type ShippingPackage,
  type ShippingParty,
  type ShippingProvider,
  type TrackingEvent,
} from '../../domain/ports/shipping-provider.port';
import { forwardPath, targetStatusFor, type Direction } from '../../domain/shipment-tracking';

/** Janelas de retirada oferecidas ao cliente (GC-AJ-041). */
export const PICKUP_WINDOWS = {
  MANHA: { ready: '09:00', close: '12:00' },
  TARDE: { ready: '13:00', close: '18:00' },
} as const;

export type PickupWindow = keyof typeof PICKUP_WINDOWS;

/** A DHL não agenda coleta a mais de 10 dias. */
const PICKUP_MAX_DAYS = 10;

/** Situações em que o pedido ainda tem envio andando. */
const IN_FLIGHT: readonly OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.KIT_SHIPPED,
  OrderStatus.KIT_DELIVERED,
  OrderStatus.SAMPLE_IN_TRANSIT,
];

export interface ShipmentView {
  readonly direction: Direction;
  readonly carrier: string;
  readonly trackingCode: string;
  readonly trackingUrl: string | null;
  readonly hasLabel: boolean;
  readonly pickup: {
    readonly confirmation: string;
    readonly at: Date;
    readonly closeTime: string | null;
    readonly location: string | null;
  } | null;
  readonly events: readonly { at: string; code: string; description: string; location: string | null }[];
}

export interface PickupInput {
  /** `AAAA-MM-DD`. */
  readonly date: string;
  readonly window: PickupWindow;
  readonly location?: string;
  /** Outro endereço na mesma cidade; ausente usa o de entrega do pedido. */
  readonly address?: {
    readonly zipCode: string;
    readonly street: string;
    readonly number: string;
    readonly complement?: string;
    readonly neighborhood: string;
    readonly city: string;
    readonly state: string;
  };
}

type OrderWithAddress = Prisma.OrderGetPayload<{
  include: { address: true; items: true; shipments: true };
}>;

/**
 * Logística do pedido com a transportadora (GC-AJ-038 a 042).
 *
 * - **Etiquetas** (039): a de ida (laboratório → cliente) e a de volta
 *   (cliente → laboratório), emitidas juntas no despacho e guardadas, porque a
 *   DHL só as entrega na criação.
 * - **Rastreio** (040): os eventos movem o pedido sozinhos, sempre para frente
 *   e pela máquina de estados, com o mesmo aviso ao cliente da troca manual.
 * - **Retirada** (041): o cliente escolhe dia e período, no endereço do pedido
 *   ou em outro da mesma cidade.
 */
@Injectable()
export class LogisticsUseCase {
  private readonly logger = new Logger(LogisticsUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SHIPPING_PROVIDER) private readonly shipping: ShippingProvider,
    private readonly notify: OrderStatusNotificationUseCase,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Emite as etiquetas que faltam (ida e volta). Repetir não reemite. */
  async generateLabels(orderNumber: string): Promise<Result<ShipmentView[]>> {
    const order = await this.loadOrder(orderNumber);
    if (!order) return fail(new NotFoundError('Pedido não encontrado.'));
    if (!order.address) return fail(new ValidationError('Pedido sem endereço de entrega.'));
    if (!IN_FLIGHT.includes(order.status as OrderStatus)) {
      return fail(
        new ConflictError('Etiquetas só para pedido pago e ainda em trânsito.', {
          status: order.status,
        }),
      );
    }

    const customer = this.customerParty(order);
    const lab = this.originParty();
    const kit = await this.kitParcel(order);

    for (const direction of ['OUTBOUND', 'INBOUND'] as const) {
      if (order.shipments.some((shipment) => shipment.direction === direction)) continue;
      const reverse = direction === 'INBOUND';
      const label = await this.shipping.createLabel({
        orderNumber: order.number,
        method: order.shippingMethod ?? 'STANDARD',
        destinationZipCode: reverse ? lab.zipCode : customer.zipCode,
        reverse,
        from: reverse ? customer : lab,
        to: reverse ? lab : customer,
        parcel: reverse ? this.returnParcel() : kit,
      });
      await this.prisma.$transaction([
        this.prisma.shipment.create({
          data: {
            orderId: order.id,
            direction,
            carrier: this.carrier(),
            trackingCode: label.trackingCode,
            trackingUrl: label.trackingUrl ?? null,
            labelFormat: label.label?.format ?? null,
            labelBase64: label.label?.base64 ?? null,
          },
        }),
        this.prisma.order.update({
          where: { id: order.id },
          data: reverse
            ? { inboundTracking: label.trackingCode }
            : { outboundTracking: label.trackingCode },
        }),
      ]);
    }

    return ok(await this.views(order.id));
  }

  /** A etiqueta guardada, para baixar. */
  async label(
    orderNumber: string,
    direction: Direction,
    ownerUserId?: string,
  ): Promise<Result<{ format: string; content: Buffer; trackingCode: string }>> {
    const order = await this.loadOrder(orderNumber);
    if (!order) return fail(new NotFoundError('Pedido não encontrado.'));
    if (ownerUserId !== undefined && order.userId !== ownerUserId) {
      return fail(new NotFoundError('Pedido não encontrado.'));
    }
    const shipment = order.shipments.find((entry) => entry.direction === direction);
    if (!shipment?.labelBase64) return fail(new NotFoundError('Etiqueta ainda não emitida.'));
    return ok({
      format: shipment.labelFormat ?? 'PDF',
      content: Buffer.from(shipment.labelBase64, 'base64'),
      trackingCode: shipment.trackingCode,
    });
  }

  /** Envios do pedido, com eventos — para o acompanhamento e o admin. */
  async shipments(orderNumber: string, ownerUserId?: string): Promise<Result<ShipmentView[]>> {
    const order = await this.loadOrder(orderNumber);
    if (!order) return fail(new NotFoundError('Pedido não encontrado.'));
    if (ownerUserId !== undefined && order.userId !== ownerUserId) {
      return fail(new NotFoundError('Pedido não encontrado.'));
    }
    return ok(await this.views(order.id));
  }

  /** Agenda a retirada da amostra na casa do cliente (GC-AJ-041). */
  async schedulePickup(
    orderNumber: string,
    userId: string,
    input: PickupInput,
    now: Date = new Date(),
  ): Promise<Result<ShipmentView[]>> {
    const order = await this.loadOrder(orderNumber);
    if (!order || order.userId !== userId) return fail(new NotFoundError('Pedido não encontrado.'));
    if (!order.address) return fail(new ValidationError('Pedido sem endereço de entrega.'));

    const status = order.status as OrderStatus;
    if (status !== OrderStatus.KIT_SHIPPED && status !== OrderStatus.KIT_DELIVERED) {
      return fail(
        new ConflictError('A retirada é agendada depois que o kit chega e antes de a amostra sair.'),
      );
    }

    const dateError = validatePickupDate(input.date, now);
    if (dateError) return fail(new ValidationError(dateError, { fields: { date: dateError } }));

    if (input.address) {
      const sameCity =
        normalize(input.address.city) === normalize(order.address.city) &&
        input.address.state.toUpperCase() === order.address.state.toUpperCase();
      if (!sameCity) {
        return fail(
          new ValidationError('A retirada em outro endereço precisa ser na mesma cidade do pedido.', {
            fields: { city: `Use um endereço em ${order.address.city}/${order.address.state}.` },
          }),
        );
      }
    }

    // Sem etiqueta de volta ainda (pedido despachado à mão), emite agora.
    let inbound = order.shipments.find((shipment) => shipment.direction === 'INBOUND');
    if (!inbound) {
      const generated = await this.generateLabels(order.number);
      if (generated.isFail()) return fail(generated.error);
      inbound = (await this.loadOrder(order.number))?.shipments.find(
        (shipment) => shipment.direction === 'INBOUND',
      );
      if (!inbound) return fail(new ConflictError('Não foi possível emitir a etiqueta de volta.'));
    }

    const window = PICKUP_WINDOWS[input.window];
    const from = input.address
      ? this.customerParty(order, input.address)
      : this.customerParty(order);
    const result = await this.shipping.schedulePickup({
      orderNumber: order.number,
      trackingCode: inbound.trackingCode,
      date: input.date,
      readyTime: window.ready,
      closeTime: window.close,
      location: input.location,
      from,
      to: this.originParty(),
      parcel: this.returnParcel(),
    });

    await this.prisma.shipment.update({
      where: { id: inbound.id },
      data: {
        pickupConfirmation: result.confirmationNumber,
        pickupAt: new Date(`${input.date}T${window.ready}:00-03:00`),
        pickupRequestedAt: now,
        pickupCloseTime: window.close,
        pickupLocation: input.location?.slice(0, 80) ?? null,
        pickupAddress: input.address ? { ...input.address } : undefined,
      },
    });
    // Auditoria, e não evento de pedido: a situação não mudou, e um evento
    // repetido apareceria como "Kit enviado" de novo no feed do cliente.
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'shipment.pickup_scheduled',
        resource: 'order',
        resourceId: order.id,
        metadata: {
          date: input.date,
          window: `${window.ready}–${window.close}`,
          confirmation: result.confirmationNumber,
        },
      },
    });

    return ok(await this.views(order.id));
  }

  /**
   * Lê o rastreio dos envios andando e move os pedidos (GC-AJ-040).
   *
   * @returns Quantos pedidos mudaram de situação.
   */
  async sync(now: Date = new Date(), onlyOrderId?: string): Promise<number> {
    const shipments = await this.prisma.shipment.findMany({
      where: {
        ...(onlyOrderId ? { orderId: onlyOrderId } : {}),
        order: { status: { in: [...IN_FLIGHT] } },
        OR: [{ lastEventCode: null }, { lastEventCode: { notIn: ['OK', 'PD', 'DD'] } }],
      },
      include: { order: true },
    });

    let moved = 0;
    for (const shipment of shipments) {
      let events: readonly TrackingEvent[];
      try {
        events = (
          await this.shipping.track({
            trackingCode: shipment.trackingCode,
            reverse: shipment.direction === 'INBOUND',
            createdAt: shipment.createdAt,
            pickupAt: shipment.pickupAt,
            pickupRequestedAt: shipment.pickupRequestedAt,
          })
        ).events;
      } catch (erro) {
        this.logger.warn(`Rastreio ${shipment.trackingCode} falhou: ${String(erro)}`);
        continue;
      }

      await this.prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          events: events.map((event) => ({ ...event, at: event.at.toISOString() })),
          lastEventCode: events[events.length - 1]?.code ?? null,
          lastSyncedAt: now,
        },
      });

      const target = targetStatusFor(shipment.direction, events);
      if (!target) continue;
      if (await this.advance(shipment.orderId, target)) moved++;
    }
    return moved;
  }

  /** Sincroniza só um pedido — o botão "Atualizar rastreio" do admin. */
  async syncOrder(orderNumber: string, now: Date = new Date()): Promise<number> {
    const order = await this.prisma.order.findUnique({
      where: { number: orderNumber },
      select: { id: true },
    });
    return order ? this.sync(now, order.id) : 0;
  }

  /** Move o pedido até `target`, um passo por vez, com evento e aviso. */
  private async advance(orderId: string, target: OrderStatus): Promise<boolean> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return false;
    const path = forwardPath(order.status as OrderStatus, target);
    for (const status of path) {
      await this.prisma.$transaction([
        this.prisma.order.update({ where: { id: order.id }, data: { status } }),
        this.prisma.orderEvent.create({
          data: {
            orderId: order.id,
            status,
            note: 'Atualizado pelo rastreio da transportadora.',
            actor: 'dhl',
          },
        }),
      ]);
      await this.notify.execute(
        { id: order.id, customerEmail: order.customerEmail, customerPhone: order.customerPhone },
        status,
      );
      this.logger.log(`Pedido ${order.number}: → ${status} pelo rastreio.`);
    }
    return path.length > 0;
  }

  private async views(orderId: string): Promise<ShipmentView[]> {
    const shipments = await this.prisma.shipment.findMany({
      where: { orderId },
      orderBy: { direction: 'asc' },
    });
    return shipments.map((shipment) => ({
      direction: shipment.direction,
      carrier: shipment.carrier,
      trackingCode: shipment.trackingCode,
      trackingUrl: shipment.trackingUrl,
      hasLabel: shipment.labelBase64 !== null,
      pickup:
        shipment.pickupConfirmation && shipment.pickupAt
          ? {
              confirmation: shipment.pickupConfirmation,
              at: shipment.pickupAt,
              closeTime: shipment.pickupCloseTime,
              location: shipment.pickupLocation,
            }
          : null,
      events: Array.isArray(shipment.events)
        ? (shipment.events as ShipmentView['events'][number][])
        : [],
    }));
  }

  private loadOrder(orderNumber: string): Promise<OrderWithAddress | null> {
    return this.prisma.order.findUnique({
      where: { number: orderNumber.trim().toUpperCase() },
      include: { address: true, items: true, shipments: true },
    });
  }

  private customerParty(
    order: OrderWithAddress,
    other?: PickupInput['address'],
  ): ShippingParty {
    const address = other ?? order.address!;
    return {
      name: order.customerName,
      phone: order.customerPhone ?? this.config.get('SHIPPING_ORIGIN_PHONE', { infer: true }),
      email: order.customerEmail,
      document: order.customerDoc.replace(/\D/g, ''),
      zipCode: address.zipCode,
      street: address.street,
      number: address.number,
      complement: address.complement ?? null,
      district: address.neighborhood,
      city: address.city,
      state: address.state,
      kind: 'private',
    };
  }

  private originParty(): ShippingParty {
    const get = <K extends keyof Env>(key: K) => this.config.get(key, { infer: true });
    return {
      name: get('SHIPPING_ORIGIN_NAME'),
      company: get('SHIPPING_ORIGIN_COMPANY'),
      phone: get('SHIPPING_ORIGIN_PHONE'),
      email: get('SHIPPING_ORIGIN_EMAIL'),
      document: get('SHIPPING_ORIGIN_DOCUMENT'),
      zipCode: get('SHIPPING_ORIGIN_ZIP'),
      street: get('SHIPPING_ORIGIN_STREET'),
      number: get('SHIPPING_ORIGIN_NUMBER'),
      district: get('SHIPPING_ORIGIN_DISTRICT'),
      city: get('SHIPPING_ORIGIN_CITY'),
      state: get('SHIPPING_ORIGIN_STATE'),
      kind: 'business',
    };
  }

  /** Caixa do kit com o peso e as medidas do produto (cadastro adm-8). */
  private async kitParcel(order: OrderWithAddress): Promise<ShippingPackage> {
    const product = await this.prisma.product.findFirst({
      where: { slug: order.items[0]?.productSlug ?? '' },
      select: { weightGrams: true, dimensionsCm: true },
    });
    const [length, width, height] = (product?.dimensionsCm ?? '')
      .split(/[x×*]/i)
      .map((part) => Math.round(Number(part.trim().replace(',', '.'))))
      .filter((value) => Number.isFinite(value) && value > 0);
    return {
      weightGrams: product?.weightGrams ?? 180,
      lengthCm: length ?? 20,
      widthCm: width ?? 15,
      heightCm: height ?? 6,
    };
  }

  private returnParcel(): ShippingPackage {
    return {
      weightGrams: this.config.get('SHIPPING_RETURN_WEIGHT_GRAMS', { infer: true }),
      lengthCm: 25,
      widthCm: 18,
      heightCm: 3,
    };
  }

  private carrier(): string {
    return this.config.get('SHIPPING_PROVIDER', { infer: true });
  }
}

/**
 * Valida a data da retirada: dia útil, a partir de amanhã e até 10 dias — o
 * limite da DHL. Devolve a mensagem de erro, ou null.
 */
export function validatePickupDate(date: string, now: Date): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Escolha uma data válida.';
  const day = new Date(`${date}T12:00:00-03:00`);
  if (Number.isNaN(day.getTime())) return 'Escolha uma data válida.';
  const weekday = day.getUTCDay();
  if (weekday === 0 || weekday === 6) return 'A retirada acontece de segunda a sexta.';

  const today = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (date <= today) return 'Escolha a partir de amanhã.';
  const limit = new Date(now.getTime() + PICKUP_MAX_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (date > limit) return `Escolha uma data nos próximos ${PICKUP_MAX_DAYS} dias.`;
  return null;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}
