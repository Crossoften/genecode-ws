import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermissions } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';
import { NotFoundError } from '@shared/domain/domain-error';

import { LogisticsUseCase } from '../../application/use-cases/logistics.use-case';
import type { Direction } from '../../domain/shipment-tracking';
import { SchedulePickupDto } from '../dtos/logistics.dto';

const DIRECTION: Readonly<Record<string, Direction>> = { ida: 'OUTBOUND', volta: 'INBOUND' };

/** Logística do pedido para a operação: etiquetas e rastreio (GC-AJ-039/040). */
@ApiTags('Admin · Logística')
@Controller('admin/pedidos/:number')
export class AdminLogisticsController {
  constructor(private readonly logistics: LogisticsUseCase) {}

  @Get('envios')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Envios do pedido (ida e volta), com rastreio' })
  async list(@Param('number') number: string) {
    const result = await this.logistics.shipments(number);
    if (result.isFail()) throw result.error;
    return { shipments: result.value };
  }

  @Post('etiquetas')
  @HttpCode(200)
  @RequirePermissions('orders.write')
  @ApiOperation({ summary: 'Emite as etiquetas de ida e de volta que faltam' })
  async labels(@Param('number') number: string) {
    const result = await this.logistics.generateLabels(number);
    if (result.isFail()) throw result.error;
    return { shipments: result.value };
  }

  @Get('etiquetas/:direcao')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Baixa a etiqueta (ida ou volta)' })
  async download(@Param('number') number: string, @Param('direcao') direcao: string) {
    const direction = DIRECTION[direcao];
    if (!direction) throw new NotFoundError('Use "ida" ou "volta".');
    const result = await this.logistics.label(number, direction);
    if (result.isFail()) throw result.error;
    return labelFile(result.value, `${number}-${direcao}`);
  }

  @Post('rastreio/atualizar')
  @HttpCode(200)
  @RequirePermissions('orders.write')
  @ApiOperation({ summary: 'Lê o rastreio agora, sem esperar a sincronização' })
  async refresh(@Param('number') number: string) {
    const shipments = await this.logistics.shipments(number);
    if (shipments.isFail()) throw shipments.error;
    const order = number.trim().toUpperCase();
    await this.logistics.syncOrder(order);
    const after = await this.logistics.shipments(order);
    if (after.isFail()) throw after.error;
    return { shipments: after.value };
  }
}

/** Logística do pedido para o cliente: rastreio, etiqueta da volta e retirada (GC-AJ-040/041). */
@ApiTags('Pedidos')
@Controller('area/pedidos/:number')
export class PatientLogisticsController {
  constructor(private readonly logistics: LogisticsUseCase) {}

  @Get('envios')
  @ApiOperation({ summary: 'Rastreio da ida e da volta do pedido da conta logada' })
  async list(@Param('number') number: string, @CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.logistics.shipments(number, user.id);
    if (result.isFail()) throw result.error;
    return { shipments: result.value };
  }

  @Get('etiqueta-volta')
  @ApiOperation({ summary: 'Etiqueta da volta, para colar no envelope da amostra' })
  async returnLabel(@Param('number') number: string, @CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.logistics.label(number, 'INBOUND', user.id);
    if (result.isFail()) throw result.error;
    return labelFile(result.value, `${number}-volta`);
  }

  @Post('retirada')
  @HttpCode(200)
  @ApiOperation({ summary: 'Agenda a retirada da amostra na residência' })
  async pickup(
    @Param('number') number: string,
    @Body() dto: SchedulePickupDto,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    const result = await this.logistics.schedulePickup(number, user.id, {
      date: dto.data,
      window: dto.periodo,
      location: dto.local,
      address: dto.endereco,
    });
    if (result.isFail()) throw result.error;
    return { shipments: result.value };
  }
}

function labelFile(
  label: { format: string; content: Buffer },
  name: string,
): StreamableFile {
  const pdf = label.format.toUpperCase() !== 'ZPL';
  return new StreamableFile(label.content, {
    type: pdf ? 'application/pdf' : 'application/octet-stream',
    disposition: `attachment; filename="etiqueta-${name}.${pdf ? 'pdf' : 'zpl'}"`,
  });
}
