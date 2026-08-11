import { Module } from '@nestjs/common';

import { IdentityModule } from '@contexts/identity/identity.module';

import { ListNotificationTriggersUseCase } from './application/use-cases/list-notification-triggers.use-case';
import { UpdateNotificationTriggerUseCase } from './application/use-cases/update-notification-trigger.use-case';
import { AdminController } from './presentation/controllers/admin.controller';

/**
 * Contexto de mensageria: gatilhos automáticos de notificação ao paciente.
 *
 * Por ora só a configuração (tela adm-10): ligar/desligar, texto-modelo e
 * canais por etapa do funil. O disparo em si acontece nas transições da máquina
 * de estados e registra em `notification_logs`, que alimenta os KPIs daqui.
 */
@Module({
  imports: [IdentityModule],
  controllers: [AdminController],
  providers: [ListNotificationTriggersUseCase, UpdateNotificationTriggerUseCase],
})
export class MessagingModule {}
