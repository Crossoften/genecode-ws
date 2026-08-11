import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequireRoles } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';
import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';

import { GetPartnerBankDetailsUseCase } from '../../application/use-cases/get-partner-bank-details.use-case';
import { ListPartnerSalesUseCase } from '../../application/use-cases/list-partner-sales.use-case';
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
    private readonly listSales: ListPartnerSalesUseCase,
    private readonly bankDetailsQuery: GetPartnerBankDetailsUseCase,
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

  /** Lista completa de vendas do cupom. */
  @Get('vendas')
  @RequireRoles('affiliate')
  @ApiOperation({ summary: 'Todas as vendas do cupom, com filtro de repasse (CSV)' })
  @ApiQuery({
    name: 'repasse',
    required: false,
    description: 'CSV de PENDING, PROCESSING, SETTLED, REVERSED, NOT_ISSUED.',
  })
  async sales(@CurrentUser() user: AuthenticatedPrincipal, @Query('repasse') payout?: string) {
    // CSV como no filtro de situação do admin: os chips da tela agrupam mais
    // de um status sob o mesmo rótulo.
    const statuses = (payout ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const result = await this.listSales.execute(user.id, statuses);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Dados de repasse atuais, para preencher o formulário. */
  @Get('dados-bancarios')
  @RequireRoles('affiliate')
  @ApiOperation({ summary: 'Dados de repasse cadastrados' })
  async currentBankDetails(@CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.bankDetailsQuery.execute(user.id);
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
    // Mesmo 404 do GET: affiliate sem registro de parceiro não pode virar 500.
    const partner = await this.prisma.partner.findUnique({ where: { userId: user.id } });
    if (!partner) throw new NotFoundError('Perfil de parceiro não encontrado.');

    await this.prisma.partner.update({
      where: { userId: user.id },
      data: { ...dto },
    });
    return { updated: true };
  }
}
