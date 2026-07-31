import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { CurrentUser, RequirePermissions } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';
import { OrderStatus, canTransition, nextStatuses } from '@contexts/ordering/domain/order-status';
import { PrismaService } from '@infra/database/prisma.service';
import { ConflictError, NotFoundError } from '@shared/domain/domain-error';

import { BusinessIntelligenceUseCase } from '../../application/use-cases/business-intelligence.use-case';

export class ChangeOrderStatusDto {
  @ApiProperty({ enum: Object.values(OrderStatus) })
  @IsIn(Object.values(OrderStatus))
  status!: OrderStatus;

  @ApiProperty({ required: false, description: 'Observação interna, não visível ao cliente.' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly bi: BusinessIntelligenceUseCase,
    private readonly prisma: PrismaService,
  ) {}

  /** BI de Vendas e Marketing. */
  @Get('bi/vendas')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Receita, conversão, abandono, cupons e vendas por UF' })
  async salesBi(@Query('dias') days?: string) {
    const since = new Date(Date.now() - (Number(days) || 30) * 86_400_000);
    return this.bi.sales(since);
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
  @ApiOperation({ summary: 'Lista pedidos, com busca e filtro de situação' })
  async orders(@Query('busca') search?: string, @Query('situacao') status?: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
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

    return orders.map((order) => ({
      number: order.number,
      customerName: order.customerName,
      product: order.items[0]?.productName ?? '—',
      totalCents: order.totalCents,
      couponCode: order.couponCode,
      status: order.status,
      // O admin precisa saber para onde pode mover, e a máquina de estados é a
      // única fonte disso — nada de o front manter a própria lista.
      allowedTransitions: nextStatuses(order.status as OrderStatus),
      createdAt: order.createdAt,
    }));
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
    @Param('number') number: string,
    @Body() dto: ChangeOrderStatusDto,
    @CurrentUser() admin: AuthenticatedPrincipal,
  ) {
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

    return { number, status: dto.status, allowedTransitions: nextStatuses(dto.status) };
  }
}
