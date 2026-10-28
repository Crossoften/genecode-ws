import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermissions } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';

import { ListAdminPartnersUseCase } from '../../application/use-cases/list-admin-partners.use-case';
import { SetPartnerActiveUseCase } from '../../application/use-cases/set-partner-active.use-case';
import { SetPartnerShareUseCase } from '../../application/use-cases/set-partner-share.use-case';
import { SetPartnerActiveDto, SetPartnerShareDto } from '../dtos/admin-partner.dto';

@ApiTags('Admin · Parceiros')
@Controller('admin/parceiros')
export class AdminPartnersController {
  constructor(
    private readonly listPartners: ListAdminPartnersUseCase,
    private readonly setActive: SetPartnerActiveUseCase,
    private readonly setShare: SetPartnerShareUseCase,
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
}
