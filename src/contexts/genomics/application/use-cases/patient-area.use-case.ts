import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

export interface PatientKit {
  readonly code: string;
  readonly status: string;
  readonly activatedAt: Date | null;
  /** Pedido a que o kit foi atribuído no despacho — casa kit ↔ pedido na UI. */
  readonly orderId: string | null;
}

export interface PatientReport {
  readonly id: string;
  readonly panelName: string;
  readonly publishedAt: Date | null;
  readonly globalIndex: number | null;
  readonly band: string | null;
}

export interface PatientArea {
  readonly kits: readonly PatientKit[];
  readonly reports: readonly PatientReport[];
  /** Pedidos em andamento, para a pessoa não precisar guardar o número. */
  readonly orders: readonly {
    readonly id: string;
    readonly number: string;
    readonly status: string;
    readonly createdAt: Date;
    readonly productName: string | null;
    /** Laudo publicado do titular do kit deste pedido, quando houver. */
    readonly reportId: string | null;
  }[];
  /**
   * Kit despachado para um pedido desta conta e ainda não ativado — alimenta o
   * banner "Você tem um kit para vincular" do painel. Null quando não há.
   */
  readonly pendingKit: {
    readonly orderNumber: string;
    readonly productName: string | null;
  } | null;
}

/**
 * Resumo da área do paciente.
 *
 * Reúne o que a pessoa logada tem: kits registrados, laudos publicados e
 * pedidos em andamento.
 *
 * ### Por que os laudos passam pelo `SubjectLink`
 *
 * Um usuário não "tem" laudos — ele tem vínculo com **titulares**, e são os
 * titulares que têm laudo. A distinção parece burocrática até o caso real
 * aparecer: o kit comprado de presente é registrado por quem coleta, e essa
 * pessoa pode ser diferente de quem pagou. Consultar por `userId` direto
 * entregaria o laudo à pessoa errada exatamente no caso que o cliente mais
 * destacou.
 *
 * Só laudos `PUBLISHED` entram. Um rascunho ou uma versão superada não são
 * documentos vigentes, e mostrar os dois deixaria o paciente com dois resultados
 * "atuais" do mesmo exame.
 */
@Injectable()
export class PatientAreaUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param userId - Conta autenticada.
   */
  async execute(userId: string): Promise<PatientArea> {
    const links = await this.prisma.subjectLink.findMany({
      where: { userId },
      select: { subjectId: true },
    });
    const subjectIds = links.map((link) => link.subjectId);

    const [kits, reports, orders] = await Promise.all([
      this.prisma.kit.findMany({
        where: { activatedByUserId: userId },
        orderBy: { activatedAt: 'desc' },
        select: { code: true, status: true, activatedAt: true, orderId: true },
      }),

      subjectIds.length === 0
        ? []
        : this.prisma.report.findMany({
            where: { subjectId: { in: subjectIds }, status: 'PUBLISHED' },
            orderBy: { publishedAt: 'desc' },
            include: {
              panel: { select: { name: true } },
              modalityIndexes: {
                where: { modality: { isGlobal: true } },
                select: { normalizedIndex: true, band: true },
              },
            },
          }),

      this.prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          number: true,
          status: true,
          createdAt: true,
          items: { select: { productName: true }, take: 1 },
        },
      }),
    ]);

    // Kit ↔ pedido ↔ laudo, num único lote de consultas: os kits despachados
    // para os pedidos desta conta dizem tanto qual pedido tem kit aguardando
    // ativação (banner do painel) quanto de qual titular vem o laudo do pedido.
    const orderIds = orders.map((order) => order.id);
    const orderKits =
      orderIds.length === 0
        ? []
        : await this.prisma.kit.findMany({
            where: { orderId: { in: orderIds } },
            select: { orderId: true, status: true, subjectId: true },
          });

    const publishedBySubject = new Map(
      reports
        .filter((report) => report.subjectId !== null)
        .map((report) => [report.subjectId, report.id]),
    );

    const pending = orderKits.find((kit) => kit.status === 'ASSIGNED');
    const pendingOrder = pending
      ? orders.find((order) => order.id === pending.orderId)
      : undefined;

    return {
      kits,
      orders: orders.map((order) => {
        const kit = orderKits.find((entry) => entry.orderId === order.id);
        return {
          id: order.id,
          number: order.number,
          status: order.status,
          createdAt: order.createdAt,
          productName: order.items[0]?.productName ?? null,
          reportId: kit?.subjectId ? (publishedBySubject.get(kit.subjectId) ?? null) : null,
        };
      }),
      pendingKit: pendingOrder
        ? {
            orderNumber: pendingOrder.number,
            productName: pendingOrder.items[0]?.productName ?? null,
          }
        : null,
      reports: reports.map((report) => {
        const global = report.modalityIndexes[0];
        return {
          id: report.id,
          panelName: report.panel.name,
          publishedAt: report.publishedAt,
          globalIndex: global ? Number(global.normalizedIndex) : null,
          band: global?.band ?? null,
        };
      }),
    };
  }
}
