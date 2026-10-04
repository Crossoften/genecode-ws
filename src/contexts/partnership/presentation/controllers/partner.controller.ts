import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser, IsPublic, RequireRoles } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';
import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError, ValidationError } from '@shared/domain/domain-error';

import { GetPartnerBankDetailsUseCase } from '../../application/use-cases/get-partner-bank-details.use-case';
import { ListPartnerSalesUseCase } from '../../application/use-cases/list-partner-sales.use-case';
import { PartnerDashboardUseCase } from '../../application/use-cases/partner-dashboard.use-case';
import { suggestCouponCode } from '../../domain/coupon-code';
import {
  validarAgencia,
  validarChavePix,
  validarConta,
} from '@shared/validation/chave-pix';
import { ConvidarParceiroUseCase } from '../../application/use-cases/convidar-parceiro.use-case';
import { BOLO_PADRAO_PERCENT } from '../../domain/rede';
import { BankDetailsDto, CriarConviteDto, RegisterPartnerDto } from '../dtos/partner.dto';

/**
 * Comissão gravada no cupom do parceiro.
 *
 * É o bolo da rede — os mesmos 20 pontos de `BOLO_PADRAO_PERCENT`. Fica aqui
 * por compatibilidade: `order-pricing` ainda calcula `commissionCents` a partir
 * do cupom, e a cascata da rede reparte **esse** valor. Quando a onda 2 mover o
 * cálculo para a cadeia, este campo vira só o total do bolo.
 *
 * O desconto padrão saiu em 03/10: cupom de parceiro é identificador, não
 * oferta. Desconto fica com a Genoa, em campanha própria.
 */
const DEFAULT_COMMISSION_PERCENT = BOLO_PADRAO_PERCENT;

@ApiTags('Parceiro')
@Controller('parceiro')
export class PartnerController {
  constructor(
    private readonly dashboard: PartnerDashboardUseCase,
    private readonly listSales: ListPartnerSalesUseCase,
    private readonly bankDetailsQuery: GetPartnerBankDetailsUseCase,
    private readonly prisma: PrismaService,
    private readonly convites: ConvidarParceiroUseCase,
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

    // Com convite, a pessoa entra na rede de quem convidou, no nível seguinte e
    // com a fatia que foi combinada no link. Sem convite, nasce raiz com o bolo
    // inteiro — que é como todo parceiro nascia antes de 03/10.
    let heranca: { conviteId: string; parentId: string; level: number; sharePercent: number } | null =
      null;
    if (dto.inviteToken) {
      const resolvido = await this.convites.resolverParaCadastro(dto.inviteToken);
      if (resolvido.isFail()) throw resolvido.error;
      heranca = resolvido.value;
    }

    const taken = new Set(
      (await this.prisma.coupon.findMany({ select: { code: true } })).map((c) => c.code),
    );
    const couponCode = suggestCouponCode(dto.displayName, taken);

    const partner = await this.prisma.$transaction(async (tx) => {
      // O cupom e o parceiro nascem juntos: um parceiro sem cupom não vende
      // nada, e é pelo cupom que a cadeia é encontrada na hora do split.
      //
      // Desconto ZERO: para o parceiro o cupom é identificador, não oferta.
      // Decisão do André em 03/10 — desconto fica só com a Genoa, em campanha
      // própria, para a margem do split não disputar com a da promoção.
      await tx.coupon.create({
        data: {
          code: couponCode,
          discountPercent: 0,
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
          parentId: heranca?.parentId ?? null,
          level: heranca?.level ?? 1,
          sharePercent: heranca?.sharePercent ?? BOLO_PADRAO_PERCENT,
        },
      });

      if (heranca) {
        await tx.partnerInvite.update({
          where: { id: heranca.conviteId },
          data: { acceptedAt: new Date(), acceptedByPartnerId: created.id },
        });
      }

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
      // O cupom do parceiro não dá desconto: é identificador.
      discountPercent: 0,
      sharePercent: Number(partner.sharePercent),
      level: partner.level,
      alreadyRegistered: false,
    };
  }

  // --- Rede de parceiros ---------------------------------------------------

  /** Cria um convite e devolve o token que vai no link. */
  @Post('rede/convites')
  @RequireRoles('affiliate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Convida um parceiro para a rede, com a fatia dele' })
  async criarConvite(@Body() dto: CriarConviteDto, @CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.convites.criar(user.id, dto);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  @Get('rede/convites')
  @RequireRoles('affiliate')
  @ApiOperation({ summary: 'Convites que este parceiro enviou' })
  async listarConvites(@CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.convites.listar(user.id);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  @Delete('rede/convites/:id')
  @RequireRoles('affiliate')
  @ApiOperation({ summary: 'Cancela um convite ainda não aceito' })
  async revogarConvite(@Param('id') id: string, @CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.convites.revogar(user.id, id);
    if (result.isFail()) throw result.error;
    return { revoked: true };
  }

  /**
   * Consulta pública do convite, pelo token do link.
   *
   * Sem sessão de propósito: quem recebe o link ainda não tem conta. Devolve só
   * quem convidou, a fatia e o nível — nada que identifique a rede inteira.
   */
  @Get('rede/convites/:token')
  @IsPublic()
  @ApiOperation({ summary: 'Mostra o convite antes do cadastro' })
  async consultarConvite(@Param('token') token: string) {
    const result = await this.convites.consultar(token);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** A rede abaixo deste parceiro, para a tela de indicações. */
  @Get('rede')
  @RequireRoles('affiliate')
  @ApiOperation({ summary: 'A rede abaixo deste parceiro' })
  async minhaRede(@CurrentUser() user: AuthenticatedPrincipal) {
    const eu = await this.prisma.partner.findUnique({ where: { userId: user.id } });
    if (!eu) throw new NotFoundError('Perfil de parceiro não encontrado.');

    const filhos = await this.prisma.partner.findMany({
      where: { parentId: eu.id },
      select: {
        id: true,
        displayName: true,
        couponCode: true,
        level: true,
        sharePercent: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      eu: {
        displayName: eu.displayName,
        couponCode: eu.couponCode,
        level: eu.level,
        sharePercent: Number(eu.sharePercent),
        podeConvidar: eu.level < 5,
      },
      indicados: filhos.map((f) => ({
        ...f,
        sharePercent: Number(f.sharePercent),
        // O que sobra para mim quando este indicado vende.
        minhaParteQuandoEleVende: Number(eu.sharePercent) - Number(f.sharePercent),
      })),
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

    // Crítica dos dados de repasse.
    //
    // O DTO só sabia dizer "é string e cabe em 140". Em 01/10 o QA gravou a
    // chave "123321123321" como TELEFONE, com agência "1" e conta "2", e
    // recebeu "Dados salvos." (GEN-08). Chave errada aqui é bonificação paga a
    // quem não deveria, ou travada no gateway — e a crítica tem de viver no
    // servidor, não só na máscara da tela, porque o PUT é alcançável sem ela.
    const dados: Record<string, string> = {};
    const erros: Record<string, string> = {};

    if (dto.pixKeyType !== undefined || dto.pixKey !== undefined) {
      const tipo = dto.pixKeyType ?? partner.pixKeyType ?? '';
      const chave = dto.pixKey ?? partner.pixKey ?? '';
      const resultado = validarChavePix(tipo, chave);
      if (!resultado.valida) {
        erros.pixKey = resultado.erro ?? 'Chave PIX inválida.';
      } else {
        dados.pixKeyType = tipo;
        dados.pixKey = resultado.normalizada as string;
      }
    }

    if (dto.bankBranch !== undefined) {
      const agencia = validarAgencia(dto.bankBranch);
      if (!agencia.valida) erros.bankBranch = agencia.erro as string;
      else dados.bankBranch = agencia.normalizada as string;
    }

    if (dto.bankAccount !== undefined) {
      const conta = validarConta(dto.bankAccount);
      if (!conta.valida) erros.bankAccount = conta.erro as string;
      else dados.bankAccount = conta.normalizada as string;
    }

    if (dto.bankName !== undefined) {
      const banco = dto.bankName.trim();
      if (banco.length < 2) erros.bankName = 'Informe o nome do banco.';
      else dados.bankName = banco;
    }

    if (Object.keys(erros).length > 0) {
      // `fields` é o formato que o mapper do front lê para marcar o campo
      // exato — o outro formato que ele aceita é o array do class-validator.
      throw new ValidationError('Confira os dados de repasse.', { fields: erros });
    }

    await this.prisma.partner.update({ where: { userId: user.id }, data: dados });
    return { updated: true };
  }
}
