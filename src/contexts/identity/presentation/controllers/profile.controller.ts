import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccountSecurityUseCase } from '../../application/use-cases/account-security.use-case';
import { ChangePasswordUseCase } from '../../application/use-cases/change-password.use-case';
import { ManageProfileUseCase } from '../../application/use-cases/manage-profile.use-case';
import { CurrentUser } from '../decorators';
import type { AuthenticatedPrincipal } from '../guards/jwt-auth.guard';
import {
  ChangePasswordDto,
  NotificationPrefsDto,
  UpdateProfileDto,
} from '../dtos/profile.dto';

/**
 * Perfil da própria conta — a tela "Meu perfil" da área do paciente lê e grava
 * aqui. Sem permissão além do login: só opera sobre o `user.id` do principal.
 */
@ApiTags('Conta')
@Controller()
export class ProfileController {
  constructor(
    private readonly profile: ManageProfileUseCase,
    private readonly changePassword: ChangePasswordUseCase,
    private readonly security: AccountSecurityUseCase,
  ) {}

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

  /**
   * Troca a senha de quem está logado.
   *
   * Conteúdo da aba "Segurança", que até 03/10 dizia só "Em breve." — o
   * titular não tinha como trocar a própria senha sem passar pelo fluxo de
   * "esqueci", que é para quem perdeu o acesso (GEN-13).
   */
  @Patch('me/senha')
  @ApiOperation({ summary: 'Troca a senha da conta logada e derruba as sessões' })
  async senha(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.changePassword.execute(user.id, dto);
    if (result.isFail()) throw result.error;
    // Todas as sessões caem, inclusive a de quem trocou: o cliente precisa
    // saber que vai ter de entrar de novo.
    return { changed: true, sessionsRevoked: true };
  }

  @Get('me/sessoes')
  @ApiOperation({ summary: 'Sessões ativas da conta logada' })
  async sessoes(@CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.security.sessoes(user.id);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  @Delete('me/sessoes/:id')
  @ApiOperation({ summary: 'Encerra uma sessão da conta logada' })
  async encerrarSessao(@Param('id') id: string, @CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.security.encerrarSessao(user.id, id);
    if (result.isFail()) throw result.error;
    return { closed: true };
  }

  @Get('me/notificacoes')
  @ApiOperation({ summary: 'Preferências de aviso da conta logada' })
  async notificacoes(@CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.security.preferencias(user.id);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  @Patch('me/notificacoes')
  @ApiOperation({ summary: 'Atualiza as preferências de aviso' })
  async salvarNotificacoes(
    @Body() dto: NotificationPrefsDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    const result = await this.security.salvarPreferencias(user.id, dto);
    if (result.isFail()) throw result.error;
    return result.value;
  }
}
