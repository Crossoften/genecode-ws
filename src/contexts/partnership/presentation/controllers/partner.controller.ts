import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequireRoles } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';
import { PrismaService } from '@infra/database/prisma.service';

import { PartnerDashboardUseCase } from '../../application/use-cases/partner-dashboard.use-case';
import { suggestCouponCode } from '../../domain/coupon-code';
import { BankDetailsDto, RegisterPartnerDto } from '../dtos/partner.dto';

/** Comissão padrão de novos parceiros. Variável por parceiro (decisão F6). */
const DEFAULT_COMMISSION_PERCENT = 20;
/** Desconto padrão oferecido ao cliente pelo cupom. */
const DEFAULT_DISCOUNT_PERCENT = 10;

@ApiTags('Parceiro')
@Controller('parceiro')
export class PartnerController {
  constructor(
    private readonly dashboard: PartnerDashboardUseCase,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Auto-cadastro de parceiro, com geração automática do cupom.
   *
   * Augusto corrigiu a premissa da agência em 01/06: não é o admin que cadastra,
   * *"a ideia é o afiliado conseguir fazer o próprio cadastro (…) e aí vai criar
   * um cuponzinho para ele lá"*.
   */
  @Post('cadastro')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cadastra o parceiro e gera o cupom exclusivo' })
  async register(@Body() dto: RegisterPartnerDto, @CurrentUser() user: AuthenticatedPrincipal) {
    const existing = await this.prisma.partner.findUnique({ where: { userId: user.id } });
    if (existing) {
      return { couponCode: existing.couponCode, alreadyRegistered: true };
    }

    const taken = new Set(
      (await this.prisma.coupon.findMany({ select: { code: true } })).map((c) => c.code),
    );
    const couponCode = suggestCouponCode(dto.displayName, taken);

    const partner = await this.prisma.$transaction(async (tx) => {
      // O cupom e o parceiro nascem juntos: um cupom sem parceiro daria desconto
      // sem destinatário de comissão, e um parceiro sem cupom não vende nada.
      await tx.coupon.create({
        data: {
          code: couponCode,
          discountPercent: DEFAULT_DISCOUNT_PERCENT,
          commissionPercent: DEFAULT_COMMISSION_PERCENT,
          partnerName: dto.displayName,
        },
      });

      const created = await tx.partner.create({
        data: {
          userId: user.id,
          type: dto.type,
          displayName: dto.displayName,
          document: dto.document,
          channel: dto.channel,
          couponCode,
        },
      });

      const role = await tx.role.findUnique({ where: { slug: 'affiliate' } });
      if (role) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: role.id } },
          update: {},
          create: { userId: user.id, roleId: role.id },
        });
      }

      return created;
    });

    return {
      couponCode: partner.couponCode,
      discountPercent: DEFAULT_DISCOUNT_PERCENT,
      commissionPercent: DEFAULT_COMMISSION_PERCENT,
      alreadyRegistered: false,
    };
  }

  /** Painel de desempenho. */
  @Get('painel')
  @RequireRoles('affiliate')
  @ApiOperation({ summary: 'Vendas, comissões e evolução semanal' })
  async panel(@CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.dashboard.execute(user.id);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /**
   * Dados bancários para repasse.
   *
   * O protótipo avisa que alterar exige confirmação por código. O
   * `VerificationPurpose.BANK_DETAILS_CHANGE` já existe no schema desde a Onda 0;
   * a exigência entra junto com o 2FA.
   */
  @Put('dados-bancarios')
  @RequireRoles('affiliate')
  @ApiOperation({ summary: 'Atualiza os dados de repasse' })
  async bankDetails(@Body() dto: BankDetailsDto, @CurrentUser() user: AuthenticatedPrincipal) {
    await this.prisma.partner.update({
      where: { userId: user.id },
      data: { ...dto },
    });
    return { updated: true };
  }
}
