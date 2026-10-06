import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { CurrentUser } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';

import { ActivateKitUseCase } from '../../application/use-cases/activate-kit.use-case';
import { ActivateKitDto } from '../dtos/kit.dto';

@ApiTags('Kits')
@Controller('kits')
export class KitController {
  constructor(private readonly activate: ActivateKitUseCase) {}

  /**
   * Ativa o kit e define o titular do dado genético.
   *
   * Exige autenticação: o titular é a conta que ativa. Rate limit apertado —
   * é o endpoint onde alguém tentaria varrer códigos.
   */
  @Post('ativar')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ativa um kit e vincula o titular' })
  async activateKit(
    @Body() dto: ActivateKitDto,
    @CurrentUser() user: AuthenticatedPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.activate.execute({
      code: dto.code,
      userId: user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    if (result.isFail()) throw result.error;
    return result.value;
  }
}
