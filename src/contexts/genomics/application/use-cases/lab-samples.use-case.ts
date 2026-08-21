import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

export interface LabSample {
  readonly orderNumber: string;
  readonly kitCode: string | null;
  readonly productName: string | null;
  /** Painel a subir para esta amostra, derivado do produto. */
  readonly panelSlug: string | null;
  readonly status: string;
  readonly receivedAt: Date | null;
  /** Já existe laudo publicado para o titular deste kit? */
  readonly reportPublished: boolean;
}

/** Slug do produto → slug do painel. Os produtos que rendem laudo. */
const PANEL_BY_PRODUCT: Readonly<Record<string, string>> = {
  nutrigenetica: 'nutrigenetics',
  performance: 'performance',
  premium: 'nutrigenetics',
};

/**
 * Fila de amostras do laboratório.
 *
 * Lista os pedidos cuja amostra já chegou (SAMPLE_RECEIVED) ou está em análise
 * (PROCESSING), com o código do kit e o painel a processar. É a tela por onde o
 * laboratório escolhe qual CSV subir — o vínculo kit↔titular vem da ativação, e
 * o CSV é casado pelo código do kit (Subject.externalCode).
 */
@Injectable()
export class LabSamplesUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<LabSample[]> {
    const orders = await this.prisma.order.findMany({
      where: { status: { in: ['SAMPLE_RECEIVED', 'PROCESSING'] } },
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        number: true,
        status: true,
        items: { select: { productSlug: true, productName: true }, take: 1 },
        events: {
          where: { status: 'SAMPLE_RECEIVED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    if (orders.length === 0) return [];

    const kits = await this.prisma.kit.findMany({
      where: { orderId: { in: orders.map((o) => o.id) } },
      select: { orderId: true, code: true, subjectId: true },
    });
    const kitByOrder = new Map(kits.map((k) => [k.orderId, k]));

    const subjectIds = kits.map((k) => k.subjectId).filter((id): id is string => id !== null);
    const published =
      subjectIds.length === 0
        ? []
        : await this.prisma.report.findMany({
            where: { subjectId: { in: subjectIds }, status: 'PUBLISHED' },
            select: { subjectId: true },
          });
    const publishedSubjects = new Set(published.map((r) => r.subjectId));

    return orders.map((order) => {
      const kit = kitByOrder.get(order.id);
      const productSlug = order.items[0]?.productSlug ?? null;
      return {
        orderNumber: order.number,
        kitCode: kit?.code ?? null,
        productName: order.items[0]?.productName ?? null,
        panelSlug: productSlug ? (PANEL_BY_PRODUCT[productSlug] ?? null) : null,
        status: order.status,
        receivedAt: order.events[0]?.createdAt ?? null,
        reportPublished: kit?.subjectId ? publishedSubjects.has(kit.subjectId) : false,
      };
    });
  }
}
