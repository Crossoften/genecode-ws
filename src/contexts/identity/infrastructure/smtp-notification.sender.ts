import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

import type { Env } from '@shared/config/env.schema';

import type {
  IdentityNotification,
  NotificationSender,
} from '../domain/ports/notification.port';

/**
 * Envio real por SMTP.
 *
 * Existe porque o adapter de log entregava o código só no log do servidor — em
 * homologação isso deixou o cadastro impossível de concluir, e foi o que o
 * cliente relatou em 29/09 como "não consigo criar conta".
 *
 * O corpo é montado aqui, e não numa camada de template, porque são três
 * mensagens curtas e transacionais. Se virarem muitas, ou ganharem identidade
 * visual, o certo é extrair — mas antecipar isso agora só somaria indireção.
 */
@Injectable()
export class SmtpNotificationSender implements NotificationSender {
  private readonly logger = new Logger('NotificationSMTP');
  private transporte: Transporter | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * O transporte é criado na primeira mensagem, não no boot.
   *
   * Assim um SMTP indisponível não impede a API de subir — a falha aparece no
   * envio, que é onde dá para reagir, e não num container que reinicia em laço.
   */
  private obterTransporte(): Transporter {
    if (this.transporte) return this.transporte;

    this.transporte = createTransport({
      host: this.config.get('SMTP_HOST', { infer: true }),
      port: Number(this.config.get('SMTP_PORT', { infer: true })),
      // 587 é STARTTLS: conecta em claro e sobe para TLS. `secure: true` só
      // para 465, que negocia TLS desde o primeiro byte.
      secure: Number(this.config.get('SMTP_PORT', { infer: true })) === 465,
      auth: {
        user: this.config.get('SMTP_USER', { infer: true }),
        pass: this.config.get('SMTP_PASSWORD', { infer: true }),
      },
    });
    return this.transporte;
  }

  async send(to: string, notification: IdentityNotification): Promise<void> {
    const mensagem = this.montar(notification);
    if (!mensagem) return;

    try {
      await this.obterTransporte().sendMail({
        from: this.config.get('SMTP_FROM', { infer: true }),
        to,
        subject: mensagem.assunto,
        text: mensagem.texto,
      });
      this.logger.log(`[${notification.kind}] enviado para ${to}`);
    } catch (erro) {
      // Não relança: uma falha de e-mail não pode derrubar o cadastro que já
      // gravou a conta. O código continua válido e existe reenvio.
      this.logger.error(
        `[${notification.kind}] falhou para ${to}: ${erro instanceof Error ? erro.message : erro}`,
      );
    }
  }

  private montar(
    notification: IdentityNotification,
  ): { assunto: string; texto: string } | null {
    switch (notification.kind) {
      case 'email-verification':
        if (!notification.code) {
          // Sem código é o aviso de tentativa de cadastro em conta existente —
          // ver a nota sobre enumeração no RegisterUserUseCase.
          return {
            assunto: 'Tentativa de cadastro na gene.code',
            texto:
              `Olá, ${notification.name}.\n\n` +
              'Alguém tentou criar uma conta na gene.code com o seu e-mail. ' +
              'Você já tem conta conosco — se foi você, é só entrar normalmente.\n\n' +
              'Se não foi você, ignore esta mensagem: nada foi alterado.\n\n' +
              'gene.code',
          };
        }
        return {
          assunto: `Seu código de verificação: ${notification.code}`,
          texto:
            `Olá, ${notification.name}.\n\n` +
            `Seu código de verificação é ${notification.code}.\n` +
            'Ele vale por 30 minutos.\n\n' +
            'Se não foi você que criou a conta, ignore esta mensagem.\n\n' +
            'gene.code',
        };

      case 'password-reset':
        return {
          assunto: 'Recuperação de senha · gene.code',
          texto:
            `Olá, ${notification.name}.\n\n` +
            'Recebemos um pedido para redefinir a sua senha. Use o código abaixo:\n\n' +
            `${notification.token}\n\n` +
            'Se não foi você, ignore esta mensagem: a senha continua a mesma.\n\n' +
            'gene.code',
        };

      case 'password-changed':
        return {
          assunto: 'Sua senha foi alterada · gene.code',
          texto:
            `Olá, ${notification.name}.\n\n` +
            'A senha da sua conta na gene.code acabou de ser alterada.\n\n' +
            'Se não foi você, entre em contato conosco imediatamente.\n\n' +
            'gene.code',
        };
    }
  }
}
