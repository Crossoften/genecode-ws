import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { HashService } from '@shared/crypto/hash.service';
import { ok, type Result } from '@shared/domain/result';

import {
  NOTIFICATION_SENDER,
  type NotificationSender,
} from '../../domain/ports/notification.port';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';
import { Email } from '../../domain/value-objects/email';
import { VERIFICATION_TTL_MINUTES } from './register-user.use-case';

/**
 * Reenvia o código de verificação de e-mail.
 *
 * Pedido do cliente em 01/10/2026. Sem isto, quem não recebia o código — caixa
 * de spam, erro de digitação no endereço, código expirado depois de 30 minutos —
 * não tinha saída nenhuma: a tela de verificação não oferecia nada, e tentar o
 * cadastro de novo com o mesmo e-mail cai no caminho de e-mail duplicado, que
 * por desenho **não** manda código.
 *
 * ### A resposta é sempre a mesma
 *
 * Igual à do cadastro e à da recuperação de senha, e pelo mesmo motivo: dizer
 * "esta conta não existe" transformaria a rota num verificador de quem é cliente
 * do laboratório. Num laboratório de genética isso revela informação de saúde
 * por inferência.
 *
 * ### O código anterior deixa de valer
 *
 * A verificação aceita o código não usado mais recente, então um código antigo
 * ainda dentro da validade continuaria funcionando. Marcar os anteriores como
 * usados mantém a promessa que a tela faz: o que vale é o último que chegou.
 */
@Injectable()
export class ResendVerificationUseCase {
  private readonly logger = new Logger(ResendVerificationUseCase.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(NOTIFICATION_SENDER) private readonly notifications: NotificationSender,
    private readonly hash: HashService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * @param rawEmail - E-mail como digitado na tela.
   * @returns Sempre sucesso. O que varia é só o que acontece do lado de dentro.
   */
  async execute(rawEmail: string): Promise<Result<void>> {
    const email = Email.create(rawEmail);
    if (email.isFail()) return ok(undefined);

    const user = await this.users.findByEmail(email.value);
    if (!user) return ok(undefined);

    // Conta já verificada não recebe código novo: não há o que confirmar, e
    // mandar um código para quem já entrou só serviria para confundir.
    if (user.emailVerifiedAt) {
      this.logger.log(`Reenvio pedido para conta já verificada (${user.id}). Nada enviado.`);
      return ok(undefined);
    }

    await this.prisma.verificationCode.updateMany({
      where: { userId: user.id, purpose: 'EMAIL_VERIFICATION', usedAt: null },
      data: { usedAt: new Date() },
    });

    const { code, codeHash } = this.hash.generateNumericCode(6);
    await this.prisma.verificationCode.create({
      data: {
        userId: user.id,
        purpose: 'EMAIL_VERIFICATION',
        codeHash,
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60_000),
      },
    });

    await this.notifications.send(email.value.value, {
      kind: 'email-verification',
      code,
      name: user.name,
    });

    return ok(undefined);
  }
}
