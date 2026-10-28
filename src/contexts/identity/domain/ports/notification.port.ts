export const NOTIFICATION_SENDER = Symbol('NOTIFICATION_SENDER');

/** Mensagens transacionais que a identidade dispara. */
export type IdentityNotification =
  | { readonly kind: 'email-verification'; readonly code: string; readonly name: string }
  | { readonly kind: 'password-reset'; readonly token: string; readonly name: string }
  | { readonly kind: 'password-changed'; readonly name: string }
  /**
   * Convite para formalizar o cadastro de quem comprou sem conta.
   *
   * Decisão da call de 09/10: *"manda o e-mail para ela, chega o e-mail lá de
   * cadastro convidando a pessoa a se cadastrar, e aí aparece os campos para
   * ela colocar o login e senha"*. Não é verificação de e-mail — a pessoa não
   * pediu conta nenhuma, então o texto precisa explicar por que a mensagem
   * chegou.
   */
  | { readonly kind: 'account-invite'; readonly token: string; readonly name: string }
  /** Código da verificação em duas etapas, pedido depois de a senha conferir. */
  | { readonly kind: 'two-factor'; readonly code: string; readonly name: string }
  /** Código que autoriza a troca dos dados de repasse do parceiro. */
  | { readonly kind: 'bank-details-change'; readonly code: string; readonly name: string }
  /**
   * Convite a um profissional sem conta para ver o laudo de quem o indicou
   * (GC-AJ-027). `name` é o titular que convidou; `link` leva ao cadastro.
   */
  | { readonly kind: 'sharing-invite'; readonly name: string; readonly link: string }
  /** Confirmação ao titular de que o pedido de exclusão foi recebido (GC-AJ-006). */
  | { readonly kind: 'deletion-requested'; readonly name: string }
  /** O pedido de exclusão, para o canal de privacidade da Genoa avaliar. */
  | {
      readonly kind: 'deletion-request-received';
      readonly name: string;
      readonly email: string;
      readonly reason: string | null;
      readonly requestId: string;
    }
  /** Aviso ao profissional já cadastrado de que um laudo foi compartilhado. */
  | {
      readonly kind: 'sharing-granted';
      readonly name: string;
      readonly patientName: string;
      readonly link: string;
    };

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
