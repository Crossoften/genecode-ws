import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { fetchPartnerSales, type SaleRow } from '../partner-sales.query';

export type { SaleRow } from '../partner-sales.query';

export interface PartnerDashboard {
  readonly couponCode: string;
  /** Comissão do parceiro em pontos percentuais — a tela exibe "15% por venda". */
  readonly commissionPercent: number;
  /** Desconto que o cupom dá ao cliente, em pontos percentuais. */
  readonly discountPercent: number;
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
 * A regra de privacidade das linhas de venda — o parceiro nunca vê dados do
 * comprador — vive em `fetchPartnerSales`, compartilhada com a lista completa.
 */
@Injectable()
export class PartnerDashboardUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(userId: string): Promise<Result<PartnerDashboard>> {
    const partner = await this.prisma.partner.findUnique({ where: { userId } });
    if (!partner) return fail(new NotFoundError('Perfil de parceiro não encontrado.'));

    const [coupon, { sales, settledCents, pendingCents }] = await Promise.all([
      this.prisma.coupon.findUnique({ where: { code: partner.couponCode } }),
      fetchPartnerSales(this.prisma, partner),
    ]);

    return ok({
      couponCode: partner.couponCode,
      // O cupom nasce na mesma transação do parceiro, então só falta se alguém
      // o apagou à mão no banco; 0% é o retrato honesto desse estado.
      commissionPercent: Number(coupon?.commissionPercent ?? 0),
      discountPercent: Number(coupon?.discountPercent ?? 0),
      totalSales: sales.length,
      commissionGeneratedCents: sales.reduce((sum, sale) => sum + sale.commissionCents, 0),
      commissionPendingCents: pendingCents,
      commissionSettledCents: settledCents,
      weeklySales: this.groupByWeek(sales.map((sale) => sale.date)),
      recentSales: sales.slice(0, 20),
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
