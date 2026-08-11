import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

import { initialsOf } from '../../domain/initials';

export interface AdminPartnerRow {
  readonly id: string;
  readonly displayName: string;
  readonly type: string;
  readonly channel: string | null;
  readonly couponCode: string;
  readonly commissionPercent: number;
  readonly active: boolean;
  readonly orders: number;
  readonly revenueCents: number;
  readonly initials: string;
}

export interface AdminPartnersKpis {
  readonly activeCount: number;
  readonly totalCount: number;
  readonly salesCents: number;
  readonly pendingCommissionCents: number;
}

export interface AdminPartnersView {
  readonly kpis: AdminPartnersKpis;
  readonly partners: readonly AdminPartnerRow[];
}

/**
 * Admin listing of every partner — active and inactive — with per-partner
 * sales aggregates and the page KPIs (tela adm-6).
 */
@Injectable()
export class ListAdminPartnersUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /** Loads all partners with their sales figures and the aggregated KPIs. */
  async execute(): Promise<AdminPartnersView> {
    const partners = await this.prisma.partner.findMany({ orderBy: { createdAt: 'asc' } });
    const codes = partners.map((partner) => partner.couponCode);

    const [coupons, salesByCoupon] = await Promise.all([
      this.prisma.coupon.findMany({ where: { code: { in: codes } } }),
      this.prisma.order.groupBy({
        by: ['couponCode'],
        where: { couponCode: { in: codes }, paidAt: { not: null } },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
    ]);

    const commissionByCode = new Map(
      coupons.map((coupon) => [coupon.code, Number(coupon.commissionPercent)]),
    );
    const salesByCode = new Map(salesByCoupon.map((group) => [group.couponCode, group]));

    const rows = partners.map((partner) => {
      const sales = salesByCode.get(partner.couponCode);
      return {
        id: partner.id,
        displayName: partner.displayName,
        type: partner.type,
        channel: partner.channel,
        couponCode: partner.couponCode,
        commissionPercent: commissionByCode.get(partner.couponCode) ?? 0,
        active: partner.active,
        orders: sales?._count._all ?? 0,
        revenueCents: sales?._sum.totalCents ?? 0,
        initials: initialsOf(partner.displayName),
      };
    });

    return {
      kpis: {
        activeCount: partners.filter((partner) => partner.active).length,
        totalCount: partners.length,
        salesCents: rows.reduce((sum, row) => sum + row.revenueCents, 0),
        pendingCommissionCents: await this.pendingCommissionCents(codes),
      },
      partners: rows,
    };
  }

  /**
   * Commission still owed to partners, for the "Comissões a pagar" KPI.
   *
   * Prefers real payout records (PENDING). When none exists — orders paid
   * before payouts started being issued at payment time — it falls back to the
   * commission of paid orders that have no settled payout, so the KPI stays
   * honest about the backlog instead of showing zero.
   */
  private async pendingCommissionCents(codes: string[]): Promise<number> {
    const pending = await this.prisma.payout.aggregate({
      where: { status: 'PENDING' },
      _sum: { amountCents: true },
    });
    const pendingCents = pending._sum.amountCents ?? 0;
    if (pendingCents > 0) return pendingCents;

    const [orders, settled] = await Promise.all([
      this.prisma.order.findMany({
        where: { couponCode: { in: codes }, paidAt: { not: null }, commissionCents: { not: null } },
        select: { id: true, commissionCents: true },
      }),
      this.prisma.payout.findMany({ where: { status: 'SETTLED' }, select: { orderId: true } }),
    ]);

    const settledOrders = new Set(settled.map((payout) => payout.orderId));
    return orders
      .filter((order) => !settledOrders.has(order.id))
      .reduce((sum, order) => sum + (order.commissionCents ?? 0), 0);
  }
}
