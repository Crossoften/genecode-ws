import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { podeConvidar } from '../../domain/rede';
import { fetchPartnerSales, type SaleRow } from '../partner-sales.query';

export type { SaleRow } from '../partner-sales.query';

export interface PartnerDashboard {
  readonly couponCode: string;
  /**
   * A fatia deste parceiro, em pontos percentuais do pedido.
   *
   * Vem da REDE, não do cupom. Com cadeia, o cupom guarda o bolo inteiro e a
   * fatia de cada um é outra coisa: numa venda do quinto nível o pedido gera
   * 20% e a raiz leva 7. Ler o cupom aqui faria o parceiro esperar o bolo.
   */
  readonly commissionPercent: number;
  /**
   * Desconto que o cupom dá ao cliente.
   *
   * Zero para cupom de parceiro desde 03/10: para ele o cupom é identificador,
   * não oferta. Desconto fica com a Genoa, em campanha própria.
   */
  readonly discountPercent: number;
  /** Nível na rede: 1 é raiz, 5 é o teto. */
  readonly level: number;
  /** O quinto nível não convida. */
  readonly podeConvidar: boolean;
  /** Quantos parceiros entraram pela indicação deste. */
  readonly indicados: number;
  /** Quanto veio de venda da rede abaixo, e não do próprio cupom. */
  readonly commissionDaRedeCents: number;
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

    const [coupon, { sales, settledCents, pendingCents }, indicados] = await Promise.all([
      this.prisma.coupon.findUnique({ where: { code: partner.couponCode } }),
      fetchPartnerSales(this.prisma, partner),
      this.prisma.partner.count({ where: { parentId: partner.id } }),
    ]);

    return ok({
      couponCode: partner.couponCode,
      commissionPercent: Number(partner.sharePercent),
      // O cupom nasce na mesma transação do parceiro, então só falta se alguém
      // o apagou à mão no banco; 0% é o retrato honesto desse estado.
      discountPercent: Number(coupon?.discountPercent ?? 0),
      level: partner.level,
      podeConvidar: podeConvidar(partner.level),
      indicados,
      commissionDaRedeCents: sales
        .filter((venda) => venda.origem === 'REDE')
        .reduce((soma, venda) => soma + venda.commissionCents, 0),
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
