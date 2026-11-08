import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermissions } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';

import { ListAdminPartnersUseCase } from '../../application/use-cases/list-admin-partners.use-case';
import { SetPartnerActiveUseCase } from '../../application/use-cases/set-partner-active.use-case';
import { SetPartnerShareUseCase } from '../../application/use-cases/set-partner-share.use-case';
import { SolicitacaoParceiroUseCase } from '../../application/use-cases/solicitacao-parceiro.use-case';
import {
  RecusarSolicitacaoDto,
  SetPartnerActiveDto,
  SetPartnerShareDto,
} from '../dtos/admin-partner.dto';

@ApiTags('Admin · Parceiros')
@Controller('admin/parceiros')
export class AdminPartnersController {
  constructor(
    private readonly listPartners: ListAdminPartnersUseCase,
    private readonly setActive: SetPartnerActiveUseCase,
    private readonly setShare: SetPartnerShareUseCase,
    private readonly solicitacoes: SolicitacaoParceiroUseCase,
  ) {}

  /** Partner table plus the page KPIs (tela adm-6). */
  @Get()
  @RequirePermissions('partners.read')
  @ApiOperation({ summary: 'Lista todos os parceiros com KPIs de vendas e comissões' })
  async list() {
    return this.listPartners.execute();
  }

  /** Inline Ativar/Desativar action of the partner table. */
  @Patch(':id/ativo')
  @RequirePermissions('partners.write')
  @ApiOperation({ summary: 'Ativa ou desativa um parceiro' })
  async changeActive(@Param('id') id: string, @Body() dto: SetPartnerActiveDto) {
    const result = await this.setActive.execute(id, dto.active);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Muda a fatia do parceiro (GC-AJ-029), respeitando pai e filhos na rede. */
  @Patch(':id/fatia')
  @RequirePermissions('partners.write')
  @ApiOperation({ summary: 'Altera a porcentagem (fatia) do parceiro' })
  async changeShare(
    @Param('id') id: string,
    @Body() dto: SetPartnerShareDto,
    @CurrentUser() admin: AuthenticatedPrincipal,
  ) {
    const result = await this.setShare.execute(id, dto.sharePercent, admin.id);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  // --- Solicitações de quem já tem conta (GC-N05-14) -----------------------

  /** Fila de pedidos "Quero ser parceiro". Sem filtro: pendentes primeiro. */
  @Get('solicitacoes')
  @RequirePermissions('partners.read')
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @ApiOperation({ summary: 'Pedidos de contas existentes para virar parceiro' })
  async solicitacoesPendentes(@Query('status') status?: string) {
    const filtro =
      status === 'PENDING' || status === 'APPROVED' || status === 'REJECTED' ? status : undefined;
    return this.solicitacoes.listar(filtro);
  }

  /**
   * Aprova o pedido: nasce o parceiro com cupom e a conta ganha o papel
   * `affiliate`, somado aos que já tinha.
   */
  @Post('solicitacoes/:id/aprovar')
  @RequirePermissions('partners.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprova o pedido e cria o parceiro com cupom' })
  async aprovarSolicitacao(@Param('id') id: string, @CurrentUser() admin: AuthenticatedPrincipal) {
    const result = await this.solicitacoes.aprovar(id, admin.id);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  @Post('solicitacoes/:id/recusar')
  @RequirePermissions('partners.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recusa o pedido; a pessoa pode pedir de novo' })
  async recusarSolicitacao(
    @Param('id') id: string,
    @Body() dto: RecusarSolicitacaoDto,
    @CurrentUser() admin: AuthenticatedPrincipal,
  ) {
    const result = await this.solicitacoes.recusar(id, admin.id, dto.motivo);
    if (result.isFail()) throw result.error;
    return result.value;
  }
}
