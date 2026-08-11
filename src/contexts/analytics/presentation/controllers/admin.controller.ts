import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { CurrentUser, RequirePermissions } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';
import { OrderStatus, canTransition, nextStatuses } from '@contexts/ordering/domain/order-status';
import { PrismaService } from '@infra/database/prisma.service';
import { ConflictError, NotFoundError } from '@shared/domain/domain-error';

import { AdminOrderDetailUseCase } from '../../application/use-cases/admin-order-detail.use-case';
import { BusinessIntelligenceUseCase } from '../../application/use-cases/business-intelligence.use-case';
import { OrderStatusNotificationUseCase } from '../../application/use-cases/order-status-notification.use-case';

const NOTIFICATION_CHANNELS = ['WHATSAPP', 'EMAIL', 'SMS'];

export class ChangeOrderStatusDto {
  @ApiProperty({ enum: Object.values(OrderStatus) })
  @IsIn(Object.values(OrderStatus))
  status!: OrderStatus;

  @ApiProperty({ required: false, description: 'Observação interna, não visível ao cliente.' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;

  @ApiProperty({
    required: false,
    isArray: true,
    enum: NOTIFICATION_CHANNELS,
    description:
      'Canais marcados no modal "Avisar o paciente por". Ausente, valem os canais padrão do gatilho.',
  })
  @IsOptional() @IsArray() @IsIn(NOTIFICATION_CHANNELS, { each: true })
  channels?: ('WHATSAPP' | 'EMAIL' | 'SMS')[];
}

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly bi: BusinessIntelligenceUseCase,
    private readonly orderDetail: AdminOrderDetailUseCase,
    private readonly notifyStatusChange: OrderStatusNotificationUseCase,
    private readonly prisma: PrismaService,
  ) {}

  /** BI de Vendas e Marketing. */
  @Get('bi/vendas')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Receita, conversão, abandono, cupons, séries e período anterior' })
  async salesBi(@Query('dias') days?: string) {
    // Clamp: janela negativa produziria agregados vazios em silêncio.
    const window = Math.min(Math.max(Math.trunc(Number(days)) || 30, 1), 365);
    return this.bi.sales(window);
  }

  /**
   * BI de Produto e Laboratório, com a esteira parada.
   *
   * A lista de parados é o que Augusto pediu em 22/06 para não deixar pedido
   * encalhado — *"é aí que tá o pênalti do negócio"*.
   */
  @Get('bi/operacao')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Esteira, kits, laudos e pedidos parados' })
  async operationsBi() {
    return this.bi.operations();
  }

  /** BI de Parceiros e Engajamento. */
  @Get('bi/parceiros')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Ranking de parceiros, comissões e repasses' })
  async partnersBi() {
    return this.bi.partners();
  }

  /** Prevalência de marcadores na base, anonimizada. */
  @Get('bi/genomica')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Prevalência de marcadores, sem identidade' })
  async genomicsBi() {
    return this.bi.genomics();
  }

  /** Lista de pedidos com busca e filtro. */
  @Get('pedidos')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Lista pedidos, com busca e filtro de situação (CSV)' })
  async orders(@Query('busca') search?: string, @Query('situacao') status?: string) {
    // `situacao` aceita CSV porque os chips-filtro do protótipo agrupam mais de
    // um OrderStatus sob o mesmo rótulo. Valores desconhecidos são descartados.
    const statuses = (status ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => (Object.values(OrderStatus) as string[]).includes(value));

    const orders = await this.prisma.order.findMany({
      where: {
        ...(statuses.length > 0 ? { status: { in: statuses as never[] } } : {}),
        ...(search
          ? {
              OR: [
                { number: { contains: search } },
                { customerName: { contains: search } },
                { customerEmail: { contains: search } },
              ],
            }
          : {}),
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Nome do parceiro vem do cupom, congelado no pedido — join leve, sem
    // atravessar até Partner.
    const codes = [
      ...new Set(
        orders
          .map((order) => order.couponCode)
          .filter((code): code is string => code !== null),
      ),
    ];
    const coupons =
      codes.length === 0
        ? []
        : await this.prisma.coupon.findMany({
            where: { code: { in: codes } },
            select: { code: true, partnerName: true },
          });
    const partnerByCode = new Map(coupons.map((coupon) => [coupon.code, coupon.partnerName]));

    return orders.map((order) => ({
      number: order.number,
      customerName: order.customerName,
      product: order.items[0]?.productName ?? '—',
      totalCents: order.totalCents,
      couponCode: order.couponCode,
      partnerName: order.couponCode ? (partnerByCode.get(order.couponCode) ?? null) : null,
      commissionCents: order.commissionCents,
      paidAt: order.paidAt,
      status: order.status,
      // O admin precisa saber para onde pode mover, e a máquina de estados é a
      // única fonte disso — nada de o front manter a própria lista.
      allowedTransitions: nextStatuses(order.status as OrderStatus),
      createdAt: order.createdAt,
    }));
  }

  /** Ficha 360° do pedido, para a tela de detalhe do admin. */
  @Get('pedidos/:number')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Detalhe completo do pedido' })
  async orderDetail360(@Param('number') number: string) {
    const result = await this.orderDetail.execute(number);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /**
   * Altera a situação do pedido.
   *
   * A transição passa pela máquina de estados: o admin não consegue mover um
   * pedido para um estágio que não faz sentido, mesmo com a requisição montada
   * à mão.
   */
  @Patch('pedidos/:number/situacao')
  @RequirePermissions('orders.write')
  @ApiOperation({ summary: 'Altera a situação do pedido' })
  async changeStatus(
    @Param('number') rawNumber: string,
    @Body() dto: ChangeOrderStatusDto,
    @CurrentUser() admin: AuthenticatedPrincipal,
  ) {
    // Mesma normalização do GET do detalhe: número chega de link/copia-e-cola.
    const number = rawNumber.trim().toUpperCase();
    const order = await this.prisma.order.findUnique({ where: { number } });
    if (!order) throw new NotFoundError('Pedido não encontrado.');

    const from = order.status as OrderStatus;
    if (!canTransition(from, dto.status)) {
      throw new ConflictError(
        `Não é possível mover de "${from}" para "${dto.status}".`,
        { from, to: dto.status, allowed: nextStatuses(from) },
      );
    }

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: dto.status },
      }),
      this.prisma.orderEvent.create({
        data: {
          orderId: order.id,
          status: dto.status,
          note: dto.note,
          actor: admin.id,
        },
      }),
    ]);

    // Notificação só depois da transição confirmada: log de aviso sobre um
    // pedido que não mudou seria auditoria mentindo.
    const notifications = await this.notifyStatusChange.execute(
      { id: order.id, customerEmail: order.customerEmail, customerPhone: order.customerPhone },
      dto.status,
      dto.channels,
    );

    return {
      number,
      status: dto.status,
      allowedTransitions: nextStatuses(dto.status),
      notifications,
    };
  }
}
