import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { ConflictError, NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { ORDER_PROGRESS, type OrderProgress } from '../../domain/ports/order-progress.port';

export interface LaudoAguardando {
  readonly reportId: string;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly panelName: string;
  readonly panelVersion: string;
  readonly version: number;
  readonly computedAt: Date;
  readonly categorias: number;
  /** Marcadores que faltaram no CSV — o que a conferência mais precisa ver. */
  readonly marcadoresFaltando: number;
  readonly orderNumber: string | null;
  readonly kitCode: string | null;
  /** Já existe laudo vigente deste painel? Liberar vai aposentá-lo. */
  readonly substituiVersao: number | null;
}

/**
 * Conferência humana antes de o laudo chegar ao titular.
 *
 * Decisão do Camara em 02/10: *"A publicação do laudo deve encerrar o pedido
 * automaticamente? Deve haver uma conferência humana responsável por disparar
 * o aviso ao cliente."*
 *
 * Reverte a decisão do André de 01/10, que era o oposto — e por um motivo que
 * continua valendo: naquele dia o laudo ficava publicado e o titular via o
 * botão cinza, porque a liberação dependia do pedido. O desenho de agora evita
 * isso deixando o laudo em **rascunho**: ninguém o vê, então não existe o
 * estado "publicado e invisível". Na liberação, laudo e pedido viram juntos.
 */
@Injectable()
export class LiberarLaudoUseCase {
  private readonly logger = new Logger(LiberarLaudoUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ORDER_PROGRESS) private readonly orders: OrderProgress,
  ) {}

  /** Laudos calculados que ainda não foram conferidos. */
  async aguardando(): Promise<readonly LaudoAguardando[]> {
    const rascunhos = await this.prisma.report.findMany({
      where: { status: 'DRAFT' },
      include: {
        panel: { select: { name: true, version: true, slug: true } },
        categoryScores: { select: { id: true } },
      },
      orderBy: { computedAt: 'asc' },
      take: 200,
    });
    if (rascunhos.length === 0) return [];

    const subjectIds = [...new Set(rascunhos.map((r) => r.subjectId))];
    const [vinculos, kits, vigentes] = await Promise.all([
      // O titular é pseudonimizado de propósito: `Subject` guarda só o código do
      // laboratório. O nome vem da CONTA vinculada — e aparece aqui porque quem
      // confere é a operação da Genoa, que já vê o nome no pedido. No módulo do
      // laboratório ele continua sem aparecer (regra L1).
      this.prisma.subjectLink.findMany({
        where: { subjectId: { in: subjectIds } },
        select: { subjectId: true, user: { select: { name: true } } },
      }),
      this.prisma.kit.findMany({
        where: { subjectId: { in: subjectIds } },
        select: { subjectId: true, code: true, orderId: true },
      }),
      this.prisma.report.findMany({
        where: { subjectId: { in: subjectIds }, status: 'PUBLISHED' },
        select: { subjectId: true, version: true, panel: { select: { slug: true } } },
      }),
    ]);

    const nome = new Map(vinculos.map((v) => [v.subjectId, v.user.name]));
    const kitPorTitular = new Map(
      kits.filter((k): k is typeof k & { subjectId: string } => k.subjectId !== null)
        .map((k) => [k.subjectId, k]),
    );

    const pedidos = await this.prisma.order.findMany({
      where: {
        id: { in: kits.map((k) => k.orderId).filter((id): id is string => id !== null) },
      },
      select: { id: true, number: true },
    });
    const numeroPorPedido = new Map(pedidos.map((p) => [p.id, p.number]));
    const vigentePorChave = new Map(
      vigentes.map((v) => [`${v.subjectId}|${v.panel.slug}`, v.version]),
    );

    return rascunhos.map((r) => {
      const kit = kitPorTitular.get(r.subjectId);
      const faltando = Array.isArray(r.missingMarkers) ? r.missingMarkers.length : 0;
      return {
        reportId: r.id,
        subjectId: r.subjectId,
        subjectName: nome.get(r.subjectId) ?? '—',
        panelName: r.panel.name,
        panelVersion: r.panel.version,
        version: r.version,
        computedAt: r.computedAt,
        categorias: r.categoryScores.length,
        marcadoresFaltando: faltando,
        orderNumber: kit?.orderId ? (numeroPorPedido.get(kit.orderId) ?? null) : null,
        kitCode: kit?.code ?? null,
        substituiVersao: vigentePorChave.get(`${r.subjectId}|${r.panel.slug}`) ?? null,
      };
    });
  }

  /**
   * Libera o laudo: publica, aposenta a versão anterior e avança o pedido.
   *
   * A ordem importa. O laudo é publicado **antes** de o pedido avançar, porque
   * o avanço dispara o aviso ao cliente — e avisar sobre um laudo que ainda não
   * está publicado mandaria a pessoa para uma tela vazia.
   *
   * @param reportId - O rascunho a liberar.
   * @param actor - Quem conferiu, para a trilha de auditoria.
   */
  async liberar(reportId: string, actor: string): Promise<Result<{ reportId: string }>> {
    const laudo = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: { panel: { select: { slug: true } } },
    });
    if (!laudo) return fail(new NotFoundError('Laudo não encontrado.'));
    if (laudo.status === 'PUBLISHED') {
      return fail(new ConflictError('Este laudo já foi liberado.'));
    }
    if (laudo.status === 'SUPERSEDED') {
      return fail(new ConflictError('Este laudo foi substituído por uma versão mais nova.'));
    }

    await this.prisma.$transaction([
      // Aposenta o vigente só agora: enquanto o novo era rascunho, derrubar o
      // anterior deixaria o titular sem laudo nenhum durante a conferência.
      this.prisma.report.updateMany({
        where: {
          subjectId: laudo.subjectId,
          panel: { slug: laudo.panel.slug },
          status: 'PUBLISHED',
          id: { not: laudo.id },
        },
        data: { status: 'SUPERSEDED' },
      }),
      this.prisma.report.update({
        where: { id: laudo.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      }),
    ]);

    // Pode lançar, e deve: laudo publicado com pedido parado é o titular vendo
    // o botão cinza — o defeito de 01/10.
    await this.orders.reportReleased(laudo.subjectId, actor);

    this.logger.log(`Laudo ${laudo.id} liberado por ${actor}.`);
    return ok({ reportId: laudo.id });
  }
}
