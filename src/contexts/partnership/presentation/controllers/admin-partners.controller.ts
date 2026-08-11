import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@contexts/identity/presentation/decorators';

import { ListAdminPartnersUseCase } from '../../application/use-cases/list-admin-partners.use-case';
import { SetPartnerActiveUseCase } from '../../application/use-cases/set-partner-active.use-case';
import { SetPartnerActiveDto } from '../dtos/admin-partner.dto';

@ApiTags('Admin · Parceiros')
@Controller('admin/parceiros')
export class AdminPartnersController {
  constructor(
    private readonly listPartners: ListAdminPartnersUseCase,
    private readonly setActive: SetPartnerActiveUseCase,
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
}
