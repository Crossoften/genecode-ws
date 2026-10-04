import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

import { initialsOf } from '../../domain/initials';

export interface AdminPartnerRow {
  readonly id: string;
  readonly displayName: string;
  readonly type: string;
  readonly channel: string | null;
  readonly couponCode: string;
  /** A fatia deste parceiro, em pontos percentuais do pedido. */
  readonly commissionPercent: number;
  readonly active: boolean;
  readonly orders: number;
  readonly revenueCents: number;
  readonly initials: string;
  /** Nível na rede: 1 é raiz, 5 é o teto. */
  readonly level: number;
  /** Quem indicou. Nulo quando é raiz de rede. */
  readonly indicadoPor: string | null;
  /** Quantos entraram pela indicação deste. */
  readonly indicados: number;
  /**
   * Repasse que NÃO foi pela adquirente e espera transferência manual.
   *
   * É o número que trava o fechamento do mês: parceiro sem unidade cadastrada
   * na Afinz tem a fatia retida pela Genoa, e alguém precisa pagar na mão.
   */
  readonly repasseManualCents: number;
}

export interface AdminPartnersKpis {
  readonly activeCount: number;
  readonly totalCount: number;
  readonly salesCents: number;
  readonly pendingCommissionCents: number;
  /** Total parado em repasse manual, somando todos os parceiros. */
  readonly repasseManualCents: number;
  /** Parceiros sem unidade na adquirente — a causa do repasse manual. */
  readonly semCadastroNaAdquirente: number;
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

    // O cupom não entra mais aqui: a fatia do parceiro vem da REDE, e o
    // desconto do cupom de parceiro é zero desde 03/10.
    const [salesByCoupon, manuais] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['couponCode'],
        where: { couponCode: { in: codes }, paidAt: { not: null } },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      // O que ficou retido por falta de unidade na adquirente.
      this.prisma.payout.groupBy({
        by: ['partnerId'],
        where: { viaSplit: false, status: { in: ['PENDING', 'PROCESSING'] } },
        _sum: { amountCents: true },
      }),
    ]);

    const manualPorParceiro = new Map(
      manuais.map((grupo) => [grupo.partnerId, grupo._sum.amountCents ?? 0]),
    );
    const nomePorId = new Map(partners.map((p) => [p.id, p.displayName]));
    const filhosPorPai = new Map<string, number>();
    for (const p of partners) {
      if (p.parentId) filhosPorPai.set(p.parentId, (filhosPorPai.get(p.parentId) ?? 0) + 1);
    }

    const salesByCode = new Map(salesByCoupon.map((group) => [group.couponCode, group]));

    const rows = partners.map((partner) => {
      const sales = salesByCode.get(partner.couponCode);
      return {
        id: partner.id,
        displayName: partner.displayName,
        type: partner.type,
        channel: partner.channel,
        couponCode: partner.couponCode,
        // A fatia vem da REDE. O cupom guarda o bolo, que é outra coisa: numa
        // venda do quinto nível o pedido gera 20% e a raiz leva 7.
        commissionPercent: Number(partner.sharePercent),
        active: partner.active,
        orders: sales?._count._all ?? 0,
        revenueCents: sales?._sum.totalCents ?? 0,
        initials: initialsOf(partner.displayName),
        level: partner.level,
        indicadoPor: partner.parentId ? (nomePorId.get(partner.parentId) ?? null) : null,
        indicados: filhosPorPai.get(partner.id) ?? 0,
        repasseManualCents: manualPorParceiro.get(partner.id) ?? 0,
      };
    });

    return {
      kpis: {
        activeCount: partners.filter((partner) => partner.active).length,
        totalCount: partners.length,
        salesCents: rows.reduce((sum, row) => sum + row.revenueCents, 0),
        pendingCommissionCents: await this.pendingCommissionCents(codes),
        repasseManualCents: rows.reduce((soma, linha) => soma + linha.repasseManualCents, 0),
        semCadastroNaAdquirente: partners.filter((p) => p.splitMerchantId === null).length,
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
      this.prisma.payout.findMany({
        where: { status: 'SETTLED' },
        select: { orderId: true, amountCents: true },
      }),
    ]);

    // Desconta VALOR liquidado, não o pedido inteiro.
    //
    // Com rede, um pedido tem vários repasses: dar o pedido por quitado porque
    // um dos níveis foi pago esconderia o que falta pagar aos outros.
    const liquidadoPorPedido = new Map<string, number>();
    for (const payout of settled) {
      liquidadoPorPedido.set(
        payout.orderId,
        (liquidadoPorPedido.get(payout.orderId) ?? 0) + payout.amountCents,
      );
    }

    return orders.reduce((sum, order) => {
      const devido = order.commissionCents ?? 0;
      const pago = liquidadoPorPedido.get(order.id) ?? 0;
      return sum + Math.max(devido - pago, 0);
    }, 0);
  }
}
