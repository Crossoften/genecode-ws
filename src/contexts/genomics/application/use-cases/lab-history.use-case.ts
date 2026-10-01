import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

/**
 * Uma linha do histórico do laboratório.
 *
 * Mesmo recorte da fila: **código de pedido e de kit, nunca o nome do titular**.
 * O laboratório trabalha por código, e o histórico não é motivo para abrir uma
 * porta de dado pessoal que a fila fechou.
 */
export interface LabHistoryEntry {
  readonly reportId: string;
  readonly orderNumber: string | null;
  readonly kitCode: string | null;
  readonly panelName: string;
  readonly panelVersion: string;
  readonly publishedAt: Date | null;
  /** Quantas categorias o laudo tem — dá a dimensão da linha antes de abrir. */
  readonly categories: number;
}

/**
 * Histórico dos laudos que o laboratório produziu.
 *
 * Existe porque, sem ele, quem sobe o CSV não tem como conferir o que saiu do
 * outro lado: a importação respondia "processados: 12" e o assunto morria ali.
 * Com o histórico o operador abre o laudo e vê os mesmos números que o titular
 * vê — é conferência de trabalho, não acesso a dado de paciente.
 *
 * Os laudos abertos daqui usam `GET /reports/:id`, que já aceita o papel `lab`.
 */
@Injectable()
export class LabHistoryUseCase {
  /** Teto da listagem. O laboratório confere o que acabou de subir, não o arquivo morto. */
  private static readonly LIMITE = 200;

  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<LabHistoryEntry[]> {
    const reports = await this.prisma.report.findMany({
      where: { status: 'PUBLISHED' },
      // `publishedAt` primeiro e `computedAt` como desempate: laudo republicado
      // mantém a data de cálculo, e ordenar só por uma das duas embaralha a lista.
      orderBy: [{ publishedAt: 'desc' }, { computedAt: 'desc' }],
      take: LabHistoryUseCase.LIMITE,
      select: {
        id: true,
        subjectId: true,
        publishedAt: true,
        panel: { select: { name: true, version: true } },
        _count: { select: { categoryScores: true } },
      },
    });
    if (reports.length === 0) return [];

    const kits = await this.prisma.kit.findMany({
      where: { subjectId: { in: reports.map((r) => r.subjectId) } },
      select: { subjectId: true, code: true, orderId: true },
    });
    const kitBySubject = new Map(
      kits.map((k) => [k.subjectId as string, k] as const),
    );

    const orderIds = kits.map((k) => k.orderId).filter((id): id is string => id !== null);
    const orders =
      orderIds.length === 0
        ? []
        : await this.prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: { id: true, number: true },
          });
    const numberByOrder = new Map(orders.map((o) => [o.id, o.number]));

    return reports.map((report) => {
      const kit = kitBySubject.get(report.subjectId);
      return {
        reportId: report.id,
        orderNumber: kit?.orderId ? (numberByOrder.get(kit.orderId) ?? null) : null,
        kitCode: kit?.code ?? null,
        panelName: report.panel.name,
        panelVersion: report.panel.version,
        publishedAt: report.publishedAt,
        categories: report._count.categoryScores,
      };
    });
  }
}
