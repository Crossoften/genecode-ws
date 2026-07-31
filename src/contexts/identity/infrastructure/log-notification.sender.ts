import { Injectable, Logger } from '@nestjs/common';

import type {
  IdentityNotification,
  NotificationSender,
} from '../domain/ports/notification.port';

/**
 * Adapter de desenvolvimento: registra a notificação no log em vez de enviar.
 *
 * Existe porque a operadora de e-mail e a de WhatsApp ainda não foram
 * contratadas — o cliente cogitou Twilio em 01/06 mas não fechou. Com a porta
 * definida, o fluxo inteiro de cadastro e recuperação já roda e é testável, e
 * plugar o provedor real depois é escrever um adapter.
 *
 * Em produção o container recusa subir com este adapter: entregar em silêncio um
 * código que ninguém recebe é pior que falhar.
 */
@Injectable()
export class LogNotificationSender implements NotificationSender {
  private readonly logger = new Logger('Notification');

  async send(to: string, notification: IdentityNotification): Promise<void> {
    switch (notification.kind) {
      case 'email-verification':
        // O código aparece no log só em desenvolvimento — é o que permite
        // testar o fluxo sem caixa de entrada.
        this.logger.log(
          notification.code
            ? `[verificação] ${to} → código ${notification.code}`
            : `[verificação] ${to} → tentativa de cadastro em conta existente`,
        );
        break;
      case 'password-reset':
        this.logger.log(`[recuperação] ${to} → token ${notification.token}`);
        break;
      case 'password-changed':
        this.logger.log(`[senha alterada] ${to}`);
        break;
    }
  }
}
