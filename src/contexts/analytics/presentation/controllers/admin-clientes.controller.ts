import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@contexts/identity/presentation/decorators';
import { PrismaService } from '@infra/database/prisma.service';

/** Onde o exame está, do vínculo ao laudo. */
export type SituacaoDoExame =
  | 'AGUARDANDO_AMOSTRA'
  | 'AMOSTRA_RECEBIDA'
  | 'LAUDO_A_LIBERAR'
  | 'LAUDO_LIBERADO';

export interface ClienteExame {
  readonly kitCode: string;
  readonly clienteNome: string | null;
  readonly clienteEmail: string | null;
  readonly vinculadoEm: Date | null;
  /** Nulo quando o kit foi presenteado fora da loja (sem pedido). */
  readonly pedido: string | null;
  readonly pedidoTotalCents: number | null;
  readonly cupom: string | null;
  /** `PEDIDO`, `CORTESIA_CUPOM` (pedido de R$ 0,00) ou `SEM_PEDIDO`. */
  readonly origem: 'PEDIDO' | 'CORTESIA_CUPOM' | 'SEM_PEDIDO';
  readonly situacao: SituacaoDoExame;
  readonly painel: string | null;
  readonly laudoId: string | null;
  readonly laudoLiberadoEm: Date | null;
}

/**
 * Clientes e exames (GC-N14-10).
 *
 * O cliente perguntou quatro vezes onde estão as pessoas que ganharam o exame
 * (09, 11, 12 e 13/11): elas criaram conta, vincularam o kit, o laudo foi
 * liberado — e não apareciam em lugar nenhum do admin, porque não tinham
 * pedido. E pediu "o relatório dos exames liberados, mantendo depois de
 * Conferir e liberar".
 *
 * A lista é por **kit vinculado**: é o que existe para todo exame, com ou sem
 * pedido. Cada linha diz de quem é, de onde veio (pedido pago, cortesia pelo
 * cupom, ou presente sem pedido) e onde está, até o laudo liberado.
 *
 * Mostra nome e e-mail: é para a operação achar a pessoa. Por isso pede
 * `orders.read`, a mesma permissão de quem já vê os dados do comprador em
 * Pedidos.
 */
@ApiTags('admin')
@Controller('admin/clientes-exames')
@RequirePermissions('orders.read')
export class AdminClientesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Kits vinculados, de quem são, de onde vieram e o laudo' })
  async list(): Promise<ClienteExame[]> {
    const kits = await this.prisma.kit.findMany({
      where: { subjectId: { not: null } },
      orderBy: { activatedAt: 'desc' },
      select: {
        code: true,
        status: true,
        subjectId: true,
        activatedAt: true,
        activatedByUserId: true,
        orderId: true,
      },
    });
    if (kits.length === 0) return [];

    const subjectIds = kits.map((k) => k.subjectId as string);
    const userIds = kits.map((k) => k.activatedByUserId).filter((id): id is string => id !== null);
    const orderIds = kits.map((k) => k.orderId).filter((id): id is string => id !== null);

    const [users, orders, reports] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      }),
      orderIds.length === 0
        ? []
        : this.prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: { id: true, number: true, totalCents: true, couponCode: true, status: true },
          }),
      this.prisma.report.findMany({
        where: { subjectId: { in: subjectIds }, status: { in: ['DRAFT', 'PUBLISHED'] } },
        orderBy: [{ publishedAt: 'desc' }, { computedAt: 'desc' }],
        select: {
          id: true,
          subjectId: true,
          status: true,
          publishedAt: true,
          panel: { select: { name: true } },
        },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const orderById = new Map(orders.map((o) => [o.id, o]));
    // Um laudo por titular: o publicado vence o rascunho.
    const laudoDo = new Map<string, (typeof reports)[number]>();
    for (const r of reports) {
      const atual = laudoDo.get(r.subjectId);
      if (!atual || (atual.status !== 'PUBLISHED' && r.status === 'PUBLISHED')) {
        laudoDo.set(r.subjectId, r);
      }
    }

    return kits.map((kit) => {
      const user = kit.activatedByUserId ? userById.get(kit.activatedByUserId) : undefined;
      const order = kit.orderId ? orderById.get(kit.orderId) : undefined;
      const laudo = laudoDo.get(kit.subjectId as string);
      const origem: ClienteExame['origem'] = !order
        ? 'SEM_PEDIDO'
        : order.totalCents === 0
          ? 'CORTESIA_CUPOM'
          : 'PEDIDO';
      const situacao: SituacaoDoExame =
        laudo?.status === 'PUBLISHED'
          ? 'LAUDO_LIBERADO'
          : laudo?.status === 'DRAFT'
            ? 'LAUDO_A_LIBERAR'
            : kit.status === 'SAMPLE_RECEIVED' ||
                order?.status === 'SAMPLE_RECEIVED' ||
                order?.status === 'PROCESSING'
              ? 'AMOSTRA_RECEBIDA'
              : 'AGUARDANDO_AMOSTRA';
      return {
        kitCode: kit.code,
        clienteNome: user?.name ?? null,
        clienteEmail: user?.email ?? null,
        vinculadoEm: kit.activatedAt,
        pedido: order?.number ?? null,
        pedidoTotalCents: order?.totalCents ?? null,
        cupom: order?.couponCode ?? null,
        origem,
        situacao,
        painel: laudo?.panel.name ?? null,
        laudoId: laudo?.id ?? null,
        laudoLiberadoEm: laudo?.status === 'PUBLISHED' ? laudo.publishedAt : null,
      };
    });
  }
}
