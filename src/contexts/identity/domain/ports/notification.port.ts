export const NOTIFICATION_SENDER = Symbol('NOTIFICATION_SENDER');

/** Mensagens transacionais que a identidade dispara. */
export type IdentityNotification =
  | { readonly kind: 'email-verification'; readonly code: string; readonly name: string }
  | { readonly kind: 'password-reset'; readonly token: string; readonly name: string }
  | { readonly kind: 'password-changed'; readonly name: string };

/**
 * Envio de notificação transacional.
 *
 * Porta, e não um `MailService` concreto, por dois motivos concretos deste
 * projeto: o cliente quer os mesmos gatilhos por e-mail, WhatsApp e SMS, com o
 * canal configurável por gatilho no admin; e a operadora de WhatsApp ainda não
 * foi contratada. Trocar ou somar canal deve ser escrever um adapter.
 */
export interface NotificationSender {
  /**
   * @param to - Endereço ou número do destinatário.
   * @param notification - O que enviar, já resolvido em dados, não em texto.
   */
  send(to: string, notification: IdentityNotification): Promise<void>;
}
