import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { EquipeUseCase, PAPEIS_INTERNOS } from '../../application/use-cases/equipe.use-case';
import { CurrentUser, RequirePermissions } from '../decorators';
import type { AuthenticatedPrincipal } from '../guards/jwt-auth.guard';
import { ConvidarColaboradorDto, DefinirAtivoDto, TrocarPapelDto } from '../dtos/account.dto';

/**
 * A equipe interna, no painel do admin.
 *
 * Pedido da call de 09/10: *"a gente precisa ter aqui… dar o acesso parcial,
 * né? Pro cara do laboratório, laboratório; pro cara não sei da onde, não sei
 * o quê"*. Ver a regra inteira — inclusive a do master — em `EquipeUseCase`.
 *
 * As rotas pedem `team.read`/`team.write`, que só admin e master têm. Um gestor
 * financeiro não administra quem entra na casa.
 */
@ApiTags('Equipe')
@Controller('admin/equipe')
export class EquipeController {
  constructor(private readonly equipe: EquipeUseCase) {}

  /** Quem é da casa e o acesso de cada um. */
  @Get()
  @RequirePermissions('team.read')
  @ApiOperation({ summary: 'A equipe interna, com o papel de cada pessoa' })
  async listar() {
    return { membros: await this.equipe.listar(), papeis: PAPEIS_INTERNOS };
  }

  /** Convida um colaborador com o papel escolhido. */
  @Post('convite')
  @RequirePermissions('team.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Convida um colaborador e define o acesso dele' })
  async convidar(
    @Body() dto: ConvidarColaboradorDto,
    @CurrentUser() ator: AuthenticatedPrincipal,
  ) {
    const result = await this.equipe.convidar(dto, ator);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Troca o papel de alguém da equipe. */
  @Patch(':id/papel')
  @RequirePermissions('team.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Altera o papel de um colaborador' })
  async trocarPapel(
    @Param('id') id: string,
    @Body() dto: TrocarPapelDto,
    @CurrentUser() ator: AuthenticatedPrincipal,
  ): Promise<void> {
    const result = await this.equipe.trocarPapel(id, dto.papel, ator);
    if (result.isFail()) throw result.error;
  }

  /** Liga ou desliga o acesso, derrubando as sessões abertas ao desligar. */
  @Patch(':id/ativo')
  @RequirePermissions('team.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Liga ou desliga o acesso de um colaborador' })
  async definirAtivo(
    @Param('id') id: string,
    @Body() dto: DefinirAtivoDto,
    @CurrentUser() ator: AuthenticatedPrincipal,
  ): Promise<void> {
    const result = await this.equipe.definirAtivo(id, dto.ativo, ator);
    if (result.isFail()) throw result.error;
  }
}
