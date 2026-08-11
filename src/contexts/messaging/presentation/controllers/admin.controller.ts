import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@contexts/identity/presentation/decorators';

import { ListNotificationTriggersUseCase } from '../../application/use-cases/list-notification-triggers.use-case';
import { UpdateNotificationTriggerUseCase } from '../../application/use-cases/update-notification-trigger.use-case';
import { UpdateNotificationTriggerDto } from '../dtos/notification.dto';

@ApiTags('Admin')
@Controller('admin/notificacoes')
export class AdminController {
  constructor(
    private readonly list: ListNotificationTriggersUseCase,
    private readonly update: UpdateNotificationTriggerUseCase,
  ) {}

  /** Notifications screen: the five trigger cards in funnel order plus KPIs. */
  @Get()
  @RequirePermissions('notifications.read')
  @ApiOperation({ summary: 'Gatilhos de notificação e KPIs de mensageria' })
  async triggers() {
    return this.list.execute();
  }

  /** Inline edit of one trigger: toggle, template text or channels. */
  @Patch(':key')
  @RequirePermissions('notifications.write')
  @ApiOperation({ summary: 'Atualiza um gatilho: ligar/desligar, texto-modelo e canais' })
  async updateTrigger(@Param('key') key: string, @Body() dto: UpdateNotificationTriggerDto) {
    const result = await this.update.execute(key, dto);
    if (result.isFail()) throw result.error;
    return result.value;
  }
}
