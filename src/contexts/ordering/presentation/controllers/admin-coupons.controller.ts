import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { CurrentUser, RequireRoles } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';
import { PrismaService } from '@infra/database/prisma.service';
import { ConflictError, NotFoundError, ValidationError } from '@shared/domain/domain-error';

export class CreateCouponDto {
  @ApiProperty({ example: 'GC100', description: 'Letras e números, 3 a 20, sem espaço.' })
  @IsString()
  @Matches(/^[A-Za-z0-9]{3,20}$/, { message: 'Use de 3 a 20 letras ou números, sem espaço.' })
  code!: string;

  @ApiProperty({ example: 100, description: 'Desconto sobre os produtos, de 1 a 100%.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100)
  discountPercent!: number;

  @ApiPropertyOptional({ description: 'Zera também o frete.', default: false })
  @IsOptional()
  @IsBoolean()
  freeShipping?: boolean;

  @ApiProperty({ example: 40, description: 'Quantas compras o cupom aceita, de 1 a 1000.' })
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses!: number;

  @ApiPropertyOptional({ example: 'Cortesia para convidados', description: 'Para quem é, uso interno.' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;
}

export class SetCouponActiveDto {
  @ApiProperty()
  @IsBoolean()
  active!: boolean;
}

/**
 * Cupons de cortesia, criados pelo master (GC-N14-02).
 *
 * Pedido da reunião de 13/11: o cupom **GC100**, que zera o produto e o frete
 * de R$ 29,90, para os kits presenteados entrarem na esteira normal — pedido,
 * relatório e jornada do cliente — sem gerar cobrança. Até aqui só existiam os
 * cupons de parceiro, que nascem com o parceiro, e ninguém criava cupom pelo
 * admin.
 *
 * **Só o master.** O André pediu que admin comum e parceiro não possam criar:
 * um cupom de 100% é dinheiro. Por isso a rota pede o papel `master`, e não uma
 * permissão que o admin também tem. O limite de usos é obrigatório pelo mesmo
 * motivo ("vai que tem um vazamento", 13/11).
 *
 * O cupom de cortesia não tem parceiro nem comissão: não entra no split.
 */
@ApiTags('admin')
@Controller('admin/cupons')
@RequireRoles('master')
export class AdminCouponsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Cupons criados pelo admin e os de parceiro, com o uso de cada um' })
  async list() {
    const cupons = await this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    return cupons.map((c) => ({
      code: c.code,
      discountPercent: Number(c.discountPercent),
      freeShipping: c.freeShipping,
      maxUses: c.maxUses,
      usedCount: c.usedCount,
      active: c.active,
      description: c.partnerName,
      // Cortesia = criado pelo admin; os demais nascem com o parceiro ou no seed.
      origem: c.createdById ? 'ADMIN' : 'PARCEIRO',
      createdAt: c.createdAt,
    }));
  }

  @Post()
  @ApiOperation({ summary: 'Cria um cupom (só master)' })
  async create(@Body() dto: CreateCouponDto, @CurrentUser() user: AuthenticatedPrincipal) {
    const code = dto.code.trim().toUpperCase();
    const existe = await this.prisma.coupon.findUnique({ where: { code } });
    if (existe) throw new ConflictError('Já existe um cupom com esse código.', { field: 'code' });
    if (dto.freeShipping && dto.discountPercent < 100) {
      // Frete grátis com desconto parcial seria outra regra de negócio, que ninguém pediu.
      throw new ValidationError('Frete incluso só no cupom de 100%.', { field: 'freeShipping' });
    }
    const criado = await this.prisma.coupon.create({
      data: {
        code,
        discountPercent: dto.discountPercent,
        commissionPercent: 0,
        freeShipping: dto.freeShipping ?? false,
        maxUses: dto.maxUses,
        partnerName: dto.description?.trim() || null,
        createdById: user.id,
      },
    });
    return {
      code: criado.code,
      discountPercent: Number(criado.discountPercent),
      freeShipping: criado.freeShipping,
      maxUses: criado.maxUses,
      usedCount: criado.usedCount,
      active: criado.active,
    };
  }

  @Patch(':code/ativo')
  @ApiOperation({ summary: 'Liga ou desliga um cupom criado pelo admin' })
  async setActive(@Param('code') code: string, @Body() dto: SetCouponActiveDto) {
    const cupom = await this.prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!cupom || !cupom.createdById) throw new NotFoundError('Cupom não encontrado.');
    await this.prisma.coupon.update({ where: { id: cupom.id }, data: { active: dto.active } });
    return { code: cupom.code, active: dto.active };
  }
}
