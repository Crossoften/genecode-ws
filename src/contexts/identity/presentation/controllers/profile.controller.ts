import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ManageProfileUseCase } from '../../application/use-cases/manage-profile.use-case';
import { CurrentUser } from '../decorators';
import type { AuthenticatedPrincipal } from '../guards/jwt-auth.guard';
import { UpdateProfileDto } from '../dtos/profile.dto';

/**
 * Perfil da própria conta — a tela "Meu perfil" da área do paciente lê e grava
 * aqui. Sem permissão além do login: só opera sobre o `user.id` do principal.
 */
@ApiTags('Conta')
@Controller()
export class ProfileController {
  constructor(private readonly profile: ManageProfileUseCase) {}

  @Get('me/perfil')
  @ApiOperation({ summary: 'Perfil da conta logada, com dados protegidos' })
  async get(@CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.profile.get(user.id);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  @Patch('me/perfil')
  @ApiOperation({ summary: 'Atualiza nome, WhatsApp e endereço da conta logada' })
  async update(@Body() dto: UpdateProfileDto, @CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.profile.update(user.id, dto);
    if (result.isFail()) throw result.error;
    return result.value;
  }
}
