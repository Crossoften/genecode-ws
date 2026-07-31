import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

export interface SaleRow {
  /** Só o número do pedido e o produto. Nunca dado do comprador. */
  readonly orderNumber: string;
  readonly productName: string;
  readonly amountCents: number;
  readonly commissionCents: number;
  readonly payoutStatus: string;
  readonly date: Date;
}

export interface PartnerDashboard {
  readonly couponCode: string;
  readonly totalSales: number;
  readonly commissionGeneratedCents: number;
  readonly commissionPendingCents: number;
  readonly commissionSettledCents: number;
  /** Vendas por semana nas últimas 8, para o gráfico. */
  readonly weeklySales: readonly { readonly week: string; readonly count: number }[];
  readonly recentSales: readonly SaleRow[];
}

/**
 * Painel do parceiro afiliado.
 *
 * ### O que o parceiro NÃO vê
 *
 * O protótipo aprovado traz um aviso explícito na tela de vendas: *"exibimos
 * apenas o número do pedido e o produto — nunca dados pessoais"*. Faz sentido:
 * o parceiro não tem relação com o comprador além de ter indicado a compra, e
 * num produto de saúde saber quem comprou já é informação sensível.
 *
 * Então nome, e-mail, CPF e endereço do comprador não saem daqui.
 */
@Injectable()
export class PartnerDashboardUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(userId: string): Promise<Result<PartnerDashboard>> {
    const partner = await this.prisma.partner.findUnique({ where: { userId } });
    if (!partner) return fail(new NotFoundError('Perfil de parceiro não encontrado.'));

    const orders = await this.prisma.order.findMany({
      where: {
        couponCode: partner.couponCode,
        status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });

    const payouts = await this.prisma.payout.findMany({ where: { partnerId: partner.id } });
    const payoutByOrder = new Map(payouts.map((payout) => [payout.orderId, payout]));

    const settled = payouts
      .filter((payout) => payout.status === 'SETTLED')
      .reduce((sum, payout) => sum + payout.amountCents, 0);
    const pending = payouts
      .filter((payout) => payout.status === 'PENDING' || payout.status === 'PROCESSING')
      .reduce((sum, payout) => sum + payout.amountCents, 0);

    return ok({
      couponCode: partner.couponCode,
      totalSales: orders.length,
      commissionGeneratedCents: orders.reduce((sum, order) => sum + (order.commissionCents ?? 0), 0),
      commissionPendingCents: pending,
      commissionSettledCents: settled,
      weeklySales: this.groupByWeek(orders.map((order) => order.createdAt)),
      recentSales: orders.slice(0, 20).map((order) => ({
        orderNumber: order.number,
        productName: order.items[0]?.productName ?? '—',
        amountCents: order.totalCents,
        commissionCents: order.commissionCents ?? 0,
        payoutStatus: payoutByOrder.get(order.id)?.status ?? 'PENDING',
        date: order.createdAt,
      })),
    });
  }

  /** Agrupa em 8 semanas, da mais antiga para a mais recente. */
  private groupByWeek(dates: readonly Date[]): { week: string; count: number }[] {
    const weeks: { week: string; count: number }[] = [];
    const now = new Date();

    for (let index = 7; index >= 0; index -= 1) {
      const start = new Date(now);
      start.setDate(start.getDate() - index * 7 - 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);

      weeks.push({
        week: start.toISOString().slice(0, 10),
        count: dates.filter((date) => date >= start && date < end).length,
      });
    }

    return weeks;
  }
}
