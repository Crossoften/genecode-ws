import { Module } from '@nestjs/common';

import { IdentityModule } from '@contexts/identity/identity.module';

import { ExportNewsletterUseCase } from './application/use-cases/export-newsletter.use-case';
import { ListNotificationTriggersUseCase } from './application/use-cases/list-notification-triggers.use-case';
import { SubscribeNewsletterUseCase } from './application/use-cases/subscribe-newsletter.use-case';
import { UpdateNotificationTriggerUseCase } from './application/use-cases/update-notification-trigger.use-case';
import { AdminController } from './presentation/controllers/admin.controller';
import { NewsletterController } from './presentation/controllers/newsletter.controller';

/**
 * Contexto de mensageria: gatilhos automáticos de notificação ao paciente.
 *
 * Por ora só a configuração (tela adm-10): ligar/desligar, texto-modelo e
 * canais por etapa do funil. O disparo em si acontece nas transições da máquina
 * de estados e registra em `notification_logs`, que alimenta os KPIs daqui.
 *
 * Também a newsletter do rodapé (GC-N05-17): inscrição pública e CSV no admin.
 */
@Module({
  imports: [IdentityModule],
  controllers: [AdminController, NewsletterController],
  providers: [
    ListNotificationTriggersUseCase,
    UpdateNotificationTriggerUseCase,
    SubscribeNewsletterUseCase,
    ExportNewsletterUseCase,
  ],
})
export class MessagingModule {}
