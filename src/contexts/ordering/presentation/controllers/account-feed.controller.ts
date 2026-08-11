import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';

import { AccountFeedUseCase } from '../../application/use-cases/account-feed.use-case';

@ApiTags('Pedidos')
@Controller()
export class AccountFeedController {
  constructor(private readonly feed: AccountFeedUseCase) {}

  /** Eventos dos pedidos da conta logada — o card "Atualizações recentes". */
  @Get('area/atualizacoes')
  @ApiOperation({ summary: 'Últimos eventos dos pedidos da conta logada' })
  async list(@CurrentUser() user: AuthenticatedPrincipal) {
    return { entries: await this.feed.execute(user.id) };
  }
}
