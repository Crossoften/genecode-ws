import { Injectable } from '@nestjs/common';

import { REPORT_SLA_DAYS } from '@contexts/ordering/application/use-cases/track-order.use-case';
import { OrderStatus, STATUS_LABEL, nextStatuses } from '@contexts/ordering/domain/order-status';
import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

export interface AdminOrderDetail {
  readonly number: string;
  readonly status: OrderStatus;
  readonly statusLabel: string;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
  readonly customer: {
    readonly name: string;
    readonly email: string;
    readonly doc: string;
    readonly phone: string | null;
  };
  readonly address: {
    readonly zipCode: string;
    readonly street: string;
    readonly number: string;
    readonly complement: string | null;
    readonly neighborhood: string;
    readonly city: string;
    readonly state: string;
  } | null;
  readonly items: readonly {
    readonly productSlug: string;
    readonly productName: string;
    readonly unitCents: number;
    readonly quantity: number;
  }[];
  readonly payments: readonly {
    readonly method: string;
    readonly status: string;
    readonly amountCents: number;
    readonly installments: number;
    readonly failureReason: string | null;
    readonly createdAt: Date;
    readonly confirmedAt: Date | null;
  }[];
  readonly events: readonly {
    readonly status: OrderStatus;
    readonly note: string | null;
    readonly actor: string | null;
    readonly createdAt: Date;
  }[];
  readonly kit: {
    readonly code: string;
    readonly status: string;
    readonly activatedAt: Date | null;
  } | null;
  readonly outboundTracking: string | null;
  readonly inboundTracking: string | null;
  readonly couponCode: string | null;
  readonly partnerName: string | null;
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly totalCents: number;
  readonly commissionCents: number | null;
  /** Same estimate the patient sees on tracking — one truth for both screens. */
  readonly estimatedReportAt: Date | null;
  readonly allowedTransitions: readonly OrderStatus[];
  /** Payment split in whole cents: GeneCode keeps total minus commission. */
  readonly split: {
    readonly geneCodeCents: number;
    readonly partnerCents: number;
    /**
     * A cascata da rede, da raiz até quem vendeu.
     *
     * Vem do `splitPlan` congelado no checkout, não de um cálculo novo: é o
     * único registro do que foi mandado à adquirente, que não devolve o split
     * em consulta nenhuma. Sem isto a tela mostrava uma linha só — "Parceiro
     * Fulano, R$ 130" — para uma venda repartida entre cinco.
     */
    readonly rede: readonly {
      readonly partnerName: string;
      readonly level: number;
      readonly sharePercent: number;
      readonly amountCents: number;
      /** Se saiu no próprio pagamento, ou se a Genoa transfere à mão. */
      readonly viaSplit: boolean;
    }[];
  };
}

/** Uma parcela do `splitPlan`, como ele foi gravado no checkout. */
interface ParcelaDoPlano {
  readonly partnerId: string;
  readonly level: number;
  readonly sharePercent: number;
  readonly amountCents: number;
  readonly viaSplit: boolean;
}

/**
 * Full 360° view of an order for the admin detail screen (adm-04).
 *
 * Everything the screen needs comes in one payload: customer, address, items,
 * payment attempts, event timeline, kit, tracking codes, partner attribution
 * and the financial split — so the frontend composes nothing.
 */
@Injectable()
export class AdminOrderDetailUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Loads the order by its public number.
   *
   * @param orderNumber - Customer-facing number, e.g. `GC-2026-50890`.
   */
  async execute(orderNumber: string): Promise<Result<AdminOrderDetail>> {
    const order = await this.prisma.order.findUnique({
      where: { number: orderNumber.trim().toUpperCase() },
      include: {
        items: true,
        address: true,
        payments: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!order) return fail(new NotFoundError('Pedido não encontrado.'));

    const [kit, coupon] = await Promise.all([
      this.prisma.kit.findFirst({ where: { orderId: order.id } }),
      order.couponCode
        ? this.prisma.coupon.findUnique({
            where: { code: order.couponCode },
            select: { partnerName: true },
          })
        : Promise.resolve(null),
    ]);

    const status = order.status as OrderStatus;

    // Mesma regra do TrackOrderUseCase, inclusive no reenvio de swab: o Map
    // fica com o último SAMPLE_RECEIVED, que é o que reinicia a contagem.
    const reachedAt = new Map(
      order.events.map((event) => [event.status as OrderStatus, event.createdAt]),
    );
    const sampleReceivedAt = reachedAt.get(OrderStatus.SAMPLE_RECEIVED) ?? null;
    const estimatedReportAt =
      status !== OrderStatus.REPORT_READY && sampleReceivedAt !== null
        ? new Date(sampleReceivedAt.getTime() + REPORT_SLA_DAYS * 86_400_000)
        : null;

    const partnerCents = order.commissionCents ?? 0;
    const rede = await this.cascata(order.splitPlan);

    return ok({
      number: order.number,
      status,
      statusLabel: STATUS_LABEL[status],
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      customer: {
        name: order.customerName,
        email: order.customerEmail,
        doc: order.customerDoc,
        phone: order.customerPhone,
      },
      address: order.address
        ? {
            zipCode: order.address.zipCode,
            street: order.address.street,
            number: order.address.number,
            complement: order.address.complement,
            neighborhood: order.address.neighborhood,
            city: order.address.city,
            state: order.address.state,
          }
        : null,
      items: order.items.map((item) => ({
        productSlug: item.productSlug,
        productName: item.productName,
        unitCents: item.unitCents,
        quantity: item.quantity,
      })),
      payments: order.payments.map((payment) => ({
        method: payment.method,
        status: payment.status,
        amountCents: payment.amountCents,
        installments: payment.installments,
        failureReason: payment.failureReason,
        createdAt: payment.createdAt,
        confirmedAt: payment.confirmedAt,
      })),
      events: order.events.map((event) => ({
        status: event.status as OrderStatus,
        note: event.note,
        actor: event.actor,
        createdAt: event.createdAt,
      })),
      kit: kit ? { code: kit.code, status: kit.status, activatedAt: kit.activatedAt } : null,
      outboundTracking: order.outboundTracking,
      inboundTracking: order.inboundTracking,
      couponCode: order.couponCode,
      partnerName: coupon?.partnerName ?? null,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      shippingCents: order.shippingCents,
      totalCents: order.totalCents,
      commissionCents: order.commissionCents,
      estimatedReportAt,
      allowedTransitions: nextStatuses(status),
      split: { geneCodeCents: order.totalCents - partnerCents, partnerCents, rede },
    });
  }

  /**
   * Traduz o `splitPlan` do pedido em linhas com nome de parceiro.
   *
   * Pedido antigo, de antes da rede, não tem plano: devolve vazio, e a tela
   * cai na linha única de sempre.
   */
  private async cascata(plano: unknown): Promise<AdminOrderDetail['split']['rede']> {
    if (!Array.isArray(plano) || plano.length === 0) return [];
    const parcelas = plano as readonly ParcelaDoPlano[];
    const parceiros = new Map(
      (
        await this.prisma.partner.findMany({
          where: { id: { in: parcelas.map((parcela) => parcela.partnerId) } },
          select: { id: true, displayName: true },
        })
      ).map((parceiro) => [parceiro.id, parceiro.displayName]),
    );
    return parcelas
      .map((parcela) => ({
        partnerName: parceiros.get(parcela.partnerId) ?? '—',
        level: parcela.level,
        sharePercent: parcela.sharePercent,
        amountCents: parcela.amountCents,
        viaSplit: parcela.viaSplit,
      }))
      .sort((a, b) => a.level - b.level);
  }
}
