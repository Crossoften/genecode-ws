import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

export interface SalesMetrics {
  readonly ordersPaid: number;
  readonly grossRevenueCents: number;
  readonly netRevenueCents: number;
  readonly commissionsCents: number;
  readonly averageTicketCents: number;
  /** Pedidos criados que nunca foram pagos. */
  readonly abandonedCheckouts: number;
  readonly conversionRate: number;
  readonly byCoupon: readonly {
    readonly code: string;
    readonly uses: number;
    readonly revenueCents: number;
  }[];
  readonly byState: readonly { readonly state: string; readonly count: number }[];
  /** Paid sales bucketed into the window's weeks — `S1` is the oldest. */
  readonly weeklySales: readonly {
    readonly week: string;
    readonly count: number;
    readonly revenueCents: number;
  }[];
  /** Revenue × commission for the last 6 calendar months, oldest first. */
  readonly monthlySeries: readonly {
    readonly month: string;
    readonly revenueCents: number;
    readonly commissionCents: number;
  }[];
  /** Same window shifted back once, for the comparison deltas. */
  readonly previousPeriod: {
    readonly ordersPaid: number;
    readonly grossRevenueCents: number;
    readonly netRevenueCents: number;
  };
}

export interface OperationsMetrics {
  readonly ordersByStatus: readonly { readonly status: string; readonly count: number }[];
  /** Pedidos parados há mais de 3 dias no mesmo estágio. */
  readonly stalled: readonly {
    readonly number: string;
    readonly status: string;
    readonly daysStalled: number;
  }[];
  readonly kitsByStatus: readonly { readonly status: string; readonly count: number }[];
  readonly reportsPublished: number;
  /** Exames que entraram na esteira no mês corrente — o "+34 no mês" do painel. */
  readonly startedThisMonth: number;
  /** Laudos publicados no mês corrente — o "+41 no mês" do painel. */
  readonly reportsPublishedThisMonth: number;
}

export interface GenomicsMetrics {
  /**
   * Prevalência de cada marcador na base, **anonimizada**.
   *
   * A consulta parte de `subject_genotypes` e nunca toca `users`. É a
   * separação entre identidade e dado genômico, feita na Onda 0, pagando
   * dividendo: dá para responder "quantos clientes têm o genótipo TT do ACTN3"
   * sem que a consulta tenha acesso a quem são.
   */
  readonly markerPrevalence: readonly {
    readonly rsId: string;
    readonly gene: string;
    readonly genotype: string;
    readonly count: number;
    readonly percent: number;
  }[];
  readonly totalSubjects: number;
}

export interface PartnersMetrics {
  readonly activePartners: number;
  /** Parceiros que ainda não venderam nada. É o indicador de ativação. */
  readonly partnersWithoutSales: number;
  readonly ranking: readonly {
    readonly displayName: string;
    readonly couponCode: string;
    readonly orders: number;
    readonly revenueCents: number;
    readonly commissionCents: number;
    /** Produto que mais vendeu, que o cliente pediu explicitamente no painel. */
    readonly topProduct: string;
  }[];
  readonly pendingPayoutCents: number;
  readonly settledPayoutCents: number;
}

/**
 * Métricas de negócio para o painel administrativo.
 *
 * Augusto foi enfático em 15/06 sobre a importância disso: *"são os números do
 * nosso negócio, se a gente não tiver isso, a gente não tem nada. A gente não
 * sabe se vai pra esquerda, pra direita."*
 *
 * E Rafael alertou, na mesma reunião, para o risco oposto: *"esse ponto aí é um
 * ponto que a gente tem que tomar cuidado, porque isso pode se tornar um segundo
 * projeto"*. O acordo foi entregar **os cinco principais de cada área**.
 *
 * Este caso de uso implementa esse teto. Não é um motor de BI genérico — são
 * consultas específicas, das métricas que o cliente nomeou.
 */
@Injectable()
export class BusinessIntelligenceUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sales and marketing BI for a rolling window.
   *
   * @param windowDays - Size of the window in days (`?dias` on the endpoint).
   * @param now - Reference instant; injectable so tests pin the window.
   */
  async sales(windowDays: number, now: Date = new Date()): Promise<SalesMetrics> {
    const windowMs = windowDays * DAY_MS;
    const since = new Date(now.getTime() - windowMs);
    const previousSince = new Date(now.getTime() - 2 * windowMs);
    // A série mensal alimenta o gráfico Receita × comissões do Financeiro, que
    // é sempre semestral — por isso ignora a janela escolhida no painel.
    const monthsStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [orders, previousPaid, monthlyPaid] = await Promise.all([
      this.prisma.order.findMany({
        where: { createdAt: { gte: since } },
        include: { address: { select: { state: true } } },
      }),
      this.prisma.order.findMany({
        where: { createdAt: { gte: previousSince, lt: since }, paidAt: { not: null } },
        select: { totalCents: true, commissionCents: true },
      }),
      this.prisma.order.findMany({
        where: { paidAt: { gte: monthsStart } },
        select: { paidAt: true, totalCents: true, commissionCents: true },
      }),
    ]);

    const paid = orders.filter((order) => order.paidAt !== null);
    const previousGross = previousPaid.reduce((sum, order) => sum + order.totalCents, 0);
    const previousCommissions = previousPaid.reduce(
      (sum, order) => sum + (order.commissionCents ?? 0),
      0,
    );
    const gross = paid.reduce((sum, order) => sum + order.totalCents, 0);
    const commissions = paid.reduce((sum, order) => sum + (order.commissionCents ?? 0), 0);

    const byCoupon = new Map<string, { uses: number; revenueCents: number }>();
    for (const order of paid) {
      if (!order.couponCode) continue;
      const current = byCoupon.get(order.couponCode) ?? { uses: 0, revenueCents: 0 };
      byCoupon.set(order.couponCode, {
        uses: current.uses + 1,
        revenueCents: current.revenueCents + order.totalCents,
      });
    }

    const byState = new Map<string, number>();
    for (const order of paid) {
      const state = order.address?.state ?? '—';
      byState.set(state, (byState.get(state) ?? 0) + 1);
    }

    return {
      ordersPaid: paid.length,
      grossRevenueCents: gross,
      netRevenueCents: gross - commissions,
      commissionsCents: commissions,
      averageTicketCents: paid.length > 0 ? Math.round(gross / paid.length) : 0,
      abandonedCheckouts: orders.length - paid.length,
      conversionRate: orders.length > 0 ? round2((paid.length / orders.length) * 100) : 0,
      byCoupon: [...byCoupon.entries()]
        .map(([code, data]) => ({ code, ...data }))
        .sort((a, b) => b.revenueCents - a.revenueCents),
      byState: [...byState.entries()]
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count),
      weeklySales: this.groupByWeek(paid, since, windowDays),
      monthlySeries: this.groupByMonth(monthlyPaid, now),
      previousPeriod: {
        ordersPaid: previousPaid.length,
        grossRevenueCents: previousGross,
        netRevenueCents: previousGross - previousCommissions,
      },
    };
  }

  /**
   * Buckets paid orders into the window's weeks by payment date, oldest first.
   *
   * Same shape as the partner dashboard chart, but labeled `S1..Sn` as the
   * admin prototype shows.
   */
  private groupByWeek(
    paid: readonly { paidAt: Date | null; totalCents: number }[],
    since: Date,
    windowDays: number,
  ): { week: string; count: number; revenueCents: number }[] {
    const weekCount = Math.max(1, Math.ceil(windowDays / 7));
    const weeks = Array.from({ length: weekCount }, (_, index) => ({
      week: `S${index + 1}`,
      count: 0,
      revenueCents: 0,
    }));

    for (const order of paid) {
      if (order.paidAt === null) continue;
      const index = Math.floor((order.paidAt.getTime() - since.getTime()) / WEEK_MS);
      // Pagamento pode cair fora da janela de criação (ex.: boleto compensado
      // depois) — vai para a ponta mais próxima em vez de sumir do gráfico.
      const bucket = weeks[Math.min(Math.max(index, 0), weekCount - 1)];
      bucket.count += 1;
      bucket.revenueCents += order.totalCents;
    }

    return weeks;
  }

  /** Groups paid orders into the last 6 calendar months, oldest first. */
  private groupByMonth(
    paid: readonly { paidAt: Date | null; totalCents: number; commissionCents: number | null }[],
    now: Date,
  ): { month: string; revenueCents: number; commissionCents: number }[] {
    const byMonth = new Map<number, { month: string; revenueCents: number; commissionCents: number }>();

    for (let offset = 5; offset >= 0; offset -= 1) {
      const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      byMonth.set(start.getFullYear() * 12 + start.getMonth(), {
        month: MONTH_LABELS[start.getMonth()],
        revenueCents: 0,
        commissionCents: 0,
      });
    }

    for (const order of paid) {
      if (order.paidAt === null) continue;
      const entry = byMonth.get(order.paidAt.getFullYear() * 12 + order.paidAt.getMonth());
      if (!entry) continue;
      entry.revenueCents += order.totalCents;
      entry.commissionCents += order.commissionCents ?? 0;
    }

    return [...byMonth.values()];
  }

  /**
   * BI de Produto e Laboratório, incluindo a esteira parada.
   *
   * A esteira é a métrica que Augusto chamou de decisiva em 22/06: *"a nossa
   * esteira de pós-venda precisa funcionar melhor do que toda a venda, porque é
   * aí que tá o pênalti do negócio"*. Ele pediu explicitamente para o pedido não
   * ficar parado sem ninguém ver.
   */
  async operations(): Promise<OperationsMetrics> {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [ordersByStatus, kitsByStatus, reportsPublished, startedThisMonth, reportsPublishedThisMonth] =
      await Promise.all([
        this.prisma.order.groupBy({ by: ['status'], _count: true }),
        this.prisma.kit.groupBy({ by: ['status'], _count: true }),
        this.prisma.report.count({ where: { status: 'PUBLISHED' } }),
        this.prisma.order.count({ where: { paidAt: { gte: monthStart } } }),
        this.prisma.report.count({ where: { status: 'PUBLISHED', publishedAt: { gte: monthStart } } }),
      ]);

    // Estados terminais não contam como parados: um pedido concluído ou
    // cancelado está parado por definição.
    const TERMINAL = ['REPORT_READY', 'CANCELLED', 'REFUNDED'];
    const threshold = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const stalledOrders = await this.prisma.order.findMany({
      where: { status: { notIn: TERMINAL as never[] }, updatedAt: { lt: threshold } },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });

    return {
      ordersByStatus: ordersByStatus.map((row) => ({ status: row.status, count: row._count })),
      kitsByStatus: kitsByStatus.map((row) => ({ status: row.status, count: row._count })),
      reportsPublished,
      startedThisMonth,
      reportsPublishedThisMonth,
      stalled: stalledOrders.map((order) => ({
        number: order.number,
        status: order.status,
        daysStalled: Math.floor((Date.now() - order.updatedAt.getTime()) / 86_400_000),
      })),
    };
  }

  /**
   * BI de Parceiros e Engajamento.
   *
   * O cliente listou o que quer ver no painel do parceiro em 15/06: *"quanto
   * vendeu, quanto converteu, previsibilidade do mês"*, mais o produto mais
   * vendido. Esta é a visão do **admin** sobre o mesmo conjunto — o ranking que
   * permite saber quem está trazendo receita e quem cadastrou e nunca vendeu.
   *
   * `partnersWithoutSales` é o indicador que o cliente não pediu e que decidi
   * incluir: um programa de parceiros cresce por número de cadastros e morre por
   * taxa de ativação. Sem ele, o ranking mostra só os que já funcionam.
   */
  async partners(): Promise<PartnersMetrics> {
    const partners = await this.prisma.partner.findMany({
      where: { active: true },
      select: { displayName: true, couponCode: true },
    });

    const codes = partners.map((partner) => partner.couponCode);

    // Só pedidos pagos entram no ranking: comissão sobre pedido não pago é
    // número que ninguém recebeu.
    const orders =
      codes.length === 0
        ? []
        : await this.prisma.order.findMany({
            where: { couponCode: { in: codes }, paidAt: { not: null } },
            include: { items: { select: { productName: true, quantity: true } } },
          });

    const byCode = new Map<
      string,
      { orders: number; revenueCents: number; commissionCents: number; products: Map<string, number> }
    >();

    for (const order of orders) {
      const code = order.couponCode!;
      const entry = byCode.get(code) ?? {
        orders: 0,
        revenueCents: 0,
        commissionCents: 0,
        products: new Map<string, number>(),
      };

      entry.orders += 1;
      entry.revenueCents += order.totalCents;
      entry.commissionCents += order.commissionCents ?? 0;
      for (const item of order.items) {
        entry.products.set(
          item.productName,
          (entry.products.get(item.productName) ?? 0) + item.quantity,
        );
      }

      byCode.set(code, entry);
    }

    const payouts = await this.prisma.payout.groupBy({
      by: ['status'],
      _sum: { amountCents: true },
    });
    const sumOf = (status: string): number =>
      payouts.find((row) => row.status === status)?._sum.amountCents ?? 0;

    const ranking = partners
      .map((partner) => {
        const data = byCode.get(partner.couponCode);
        const topProduct =
          data === undefined
            ? '—'
            : ([...data.products.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—');

        return {
          displayName: partner.displayName,
          couponCode: partner.couponCode,
          orders: data?.orders ?? 0,
          revenueCents: data?.revenueCents ?? 0,
          commissionCents: data?.commissionCents ?? 0,
          topProduct,
        };
      })
      .sort((a, b) => b.revenueCents - a.revenueCents);

    return {
      activePartners: partners.length,
      partnersWithoutSales: ranking.filter((entry) => entry.orders === 0).length,
      ranking,
      pendingPayoutCents: sumOf('PENDING'),
      settledPayoutCents: sumOf('SETTLED'),
    };
  }

  /**
   * Prevalência de marcadores na base, anonimizada.
   *
   * Pedida na Devolutiva Documento Fluxo V2, com a ressalva explícita de "dados
   * anonimizados". A anonimização aqui não é um passo de mascaramento aplicado
   * depois — é consequência de a consulta nunca tocar a tabela de identidade.
   */
  async genomics(): Promise<GenomicsMetrics> {
    const totalSubjects = await this.prisma.subject.count();

    const rows = await this.prisma.subjectGenotype.groupBy({
      by: ['snpId', 'genotype'],
      _count: true,
      orderBy: { _count: { snpId: 'desc' } },
      take: 40,
    });

    const snps = await this.prisma.snp.findMany({
      where: { id: { in: rows.map((row) => row.snpId) } },
      select: { id: true, rsId: true, gene: true },
    });
    const snpById = new Map(snps.map((snp) => [snp.id, snp]));

    return {
      totalSubjects,
      markerPrevalence: rows.map((row) => {
        const snp = snpById.get(row.snpId);
        return {
          rsId: snp?.rsId ?? '—',
          gene: snp?.gene ?? '—',
          genotype: row.genotype,
          count: row._count,
          percent: totalSubjects > 0 ? round2((row._count / totalSubjects) * 100) : 0,
        };
      }),
    };
  }
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

const MONTH_LABELS = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
] as const;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
