import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

export interface LabSample {
  /** Nulo no kit de cortesia: ele foi vinculado sem passar por um pedido. */
  readonly orderNumber: string | null;
  readonly kitCode: string | null;
  readonly productName: string | null;
  /** Painel a subir para esta amostra, derivado do produto. */
  readonly panelSlug: string | null;
  /**
   * `SAMPLE_RECEIVED` e `PROCESSING` vêm do pedido. `KIT_LINKED` é o kit que
   * alguém já vinculou a um titular, mas cuja amostra não foi registrada como
   * recebida — o caso do kit presenteado, que volta em mãos (GC-N14-01).
   */
  readonly status: string;
  /** Recebida em (pedido) ou vinculado em (`KIT_LINKED`). */
  readonly receivedAt: Date | null;
  /** Já existe laudo publicado para o titular deste kit? */
  readonly reportPublished: boolean;
  /**
   * O laudo saiu e espera a conferência da Genoa.
   *
   * Vale como "não suba este CSV de novo": o cálculo já aconteceu, e a linha
   * fica na fila só para o operador saber onde o trabalho dele parou. O
   * resultado está no histórico.
   */
  readonly reportAwaiting: boolean;
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
 *
 * ### Kit vinculado sem pedido na fila (GC-N14-01)
 *
 * Também entram os kits já ativados por um titular que a fila por pedido não
 * enxerga: o kit presenteado, sem pedido, e o kit cujo pedido parou antes de
 * "amostra recebida" porque o envelope voltou em mãos. Saem com `KIT_LINKED`,
 * para a tela dizer o que são. Sem isto o laboratório sobe o CSV às cegas.
 *
 * ### Amostra com laudo no ar sai da fila
 *
 * Decisão do André na call de 09/10, vendo a fila: *"se tem um laudo
 * publicado, ele tem que sair da fila de amostra"*. A fila é a lista de
 * trabalho; amostra laudada não é trabalho, é arquivo — e o Flávio tinha
 * acabado de dizer que a lista cheia de concluído "vai tumultuar".
 *
 * Normalmente a liberação do laudo já move o pedido para `REPORT_READY` e ele
 * cai fora daqui por si. O filtro cobre o resto: pedido que ficou para trás na
 * esteira e titular com laudo vigente de uma reemissão.
 *
 * O rascunho **continua na fila**, com aviso próprio. Ele é trabalho em curso:
 * sair daqui antes da conferência faria o CSV recém-subido desaparecer das
 * duas telas que o operador olha.
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
    const kits =
      orders.length === 0
        ? []
        : await this.prisma.kit.findMany({
            where: { orderId: { in: orders.map((o) => o.id) } },
            select: { orderId: true, code: true, subjectId: true },
          });
    const kitByOrder = new Map(kits.map((k) => [k.orderId, k]));

    // Kits já vinculados a um titular que a fila por pedido não enxerga.
    //
    // Em 12–13/11 o técnico da Genoa não achava os exames dos kits presenteados:
    // eles foram ativados pelo titular, mas nunca tiveram pedido em
    // SAMPLE_RECEIVED — o envelope voltou em mãos. A importação do CSV casa
    // pelo código do kit e funciona para eles; só a fila os escondia.
    const vinculados = await this.prisma.kit.findMany({
      where: {
        subjectId: { not: null },
        status: { in: ['ACTIVATED', 'SAMPLE_SENT', 'SAMPLE_RECEIVED'] },
        OR: [{ orderId: null }, { orderId: { notIn: orders.map((o) => o.id) } }],
      },
      orderBy: { activatedAt: 'asc' },
      select: { code: true, subjectId: true, activatedAt: true, orderId: true },
    });
    const pedidosDosVinculados = await this.pedidosPorId(
      vinculados.map((k) => k.orderId).filter((id): id is string => id !== null),
    );

    const subjectIds = [...kits, ...vinculados]
      .map((k) => k.subjectId)
      .filter((id): id is string => id !== null);
    const laudos =
      subjectIds.length === 0
        ? []
        : await this.prisma.report.findMany({
            where: { subjectId: { in: subjectIds }, status: { in: ['DRAFT', 'PUBLISHED'] } },
            select: { subjectId: true, status: true },
          });
    const publicados = new Set(
      laudos.filter((r) => r.status === 'PUBLISHED').map((r) => r.subjectId),
    );
    const rascunhos = new Set(laudos.filter((r) => r.status === 'DRAFT').map((r) => r.subjectId));

    const daFila: LabSample[] = orders.map((order) => {
        const kit = kitByOrder.get(order.id);
        const productSlug = order.items[0]?.productSlug ?? null;
        const titular = kit?.subjectId ?? null;
        return {
          orderNumber: order.number,
          kitCode: kit?.code ?? null,
          productName: order.items[0]?.productName ?? null,
          panelSlug: productSlug ? (PANEL_BY_PRODUCT[productSlug] ?? null) : null,
          status: order.status,
          receivedAt: order.events[0]?.createdAt ?? null,
          reportPublished: titular !== null && publicados.has(titular),
          reportAwaiting: titular !== null && rascunhos.has(titular),
        };
      });

    const dosVinculados: LabSample[] = vinculados.map((kit) => {
      const pedido = kit.orderId ? pedidosDosVinculados.get(kit.orderId) : undefined;
      const productSlug = pedido?.productSlug ?? null;
      return {
        orderNumber: pedido?.number ?? null,
        kitCode: kit.code,
        productName: pedido?.productName ?? null,
        panelSlug: productSlug ? (PANEL_BY_PRODUCT[productSlug] ?? null) : null,
        status: 'KIT_LINKED',
        receivedAt: kit.activatedAt,
        reportPublished: kit.subjectId !== null && publicados.has(kit.subjectId),
        reportAwaiting: kit.subjectId !== null && rascunhos.has(kit.subjectId),
      };
    });

    return [...daFila, ...dosVinculados].filter((amostra) => !amostra.reportPublished);
  }

  private async pedidosPorId(
    ids: readonly string[],
  ): Promise<Map<string, { number: string; productSlug: string | null; productName: string | null }>> {
    if (ids.length === 0) return new Map();
    const pedidos = await this.prisma.order.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        number: true,
        items: { select: { productSlug: true, productName: true }, take: 1 },
      },
    });
    return new Map(
      pedidos.map((p) => [
        p.id,
        {
          number: p.number,
          productSlug: p.items[0]?.productSlug ?? null,
          productName: p.items[0]?.productName ?? null,
        },
      ]),
    );
  }
}
