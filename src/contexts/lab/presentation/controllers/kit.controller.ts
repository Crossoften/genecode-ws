import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { CurrentUser, RequirePermissions } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';

import { ActivateKitUseCase } from '../../application/use-cases/activate-kit.use-case';
import { EmitirKitsUseCase } from '../../application/use-cases/emitir-kits.use-case';
import { ActivateKitDto, EmitirKitsDto } from '../dtos/kit.dto';

@ApiTags('Kits')
@Controller('kits')
export class KitController {
  constructor(
    private readonly activate: ActivateKitUseCase,
    private readonly emitir: EmitirKitsUseCase,
  ) {}

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

  /**
   * Emite um lote de etiquetas, queimando códigos da lista primitiva da Genoa.
   *
   * Não inventa código: tira os próximos da lista do cliente, em ordem de
   * sequencial, que é a ordem em que ele imprime.
   */
  @Post('lotes')
  @RequirePermissions('kits.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Emite um lote de kits a partir da lista oficial' })
  async emitirLote(@Body() dto: EmitirKitsDto) {
    const result = await this.emitir.execute(dto.quantity, dto.reference);
    if (result.isFail()) throw result.error;
    return result.value;
  }
}
