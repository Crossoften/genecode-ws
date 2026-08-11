import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { fetchPartnerSales, SALE_PAYOUT_STATUSES, type SaleRow } from '../partner-sales.query';

export interface PartnerSalesList {
  readonly sales: readonly SaleRow[];
  /** Aggregates over ALL sales, never over the filtered page — see execute. */
  readonly totalCount: number;
  readonly settledCents: number;
  readonly pendingCents: number;
}

/**
 * Complete sales list of the logged-in partner's coupon, with an optional
 * payout-status filter. Rows come from `fetchPartnerSales`, which enforces the
 * privacy rule: order number and product only, never buyer data.
 */
@Injectable()
export class ListPartnerSalesUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    userId: string,
    payoutStatuses: readonly string[] = [],
  ): Promise<Result<PartnerSalesList>> {
    const partner = await this.prisma.partner.findUnique({ where: { userId } });
    if (!partner) return fail(new NotFoundError('Perfil de parceiro não encontrado.'));

    const { sales, settledCents, pendingCents } = await fetchPartnerSales(this.prisma, partner);

    // Valores desconhecidos são descartados, como nos chips-filtro do admin.
    const statuses = payoutStatuses.filter((value) =>
      (SALE_PAYOUT_STATUSES as readonly string[]).includes(value),
    );

    return ok({
      sales:
        statuses.length > 0 ? sales.filter((sale) => statuses.includes(sale.payoutStatus)) : sales,
      // Os agregados ignoram o filtro de propósito: são os cartões-resumo da
      // tela, que precisam continuar batendo com o painel enquanto os chips
      // filtram só a tabela.
      totalCount: sales.length,
      settledCents,
      pendingCents,
    });
  }
}
