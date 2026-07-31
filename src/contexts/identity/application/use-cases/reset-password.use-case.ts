import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { HashService } from '@shared/crypto/hash.service';
import { ValidationError } from '@shared/domain/domain-error';
import { fail, okVoid, type Result } from '@shared/domain/result';

import {
  NOTIFICATION_SENDER,
  type NotificationSender,
} from '../../domain/ports/notification.port';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../../domain/ports/refresh-token.repository';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';
import { Email } from '../../domain/value-objects/email';
import { Password } from '../../domain/value-objects/password';

/** Janela curta: o link chega por e-mail e é usado em minutos, não em dias. */
const RESET_TTL_MINUTES = 30;

/**
 * Redefinição de senha em duas etapas.
 *
 * Reescrito do zero em relação ao backend anterior, onde a cadeia era:
 * uma rota pública listava todos os usuários **com o código de reset**, e o
 * endpoint de redefinição aceitava esse código sem vincular a e-mail e sem
 * checar expiração. Qualquer pessoa assumia qualquer conta, inclusive a Master.
 *
 * O que mudou:
 *
 * - token opaco de 256 bits (`crypto.randomBytes`), não código de 4 dígitos
 * - armazenado só como hash SHA-256
 * - vinculado ao `userId`, uso único, com validade de 30 minutos
 * - **todas as sessões são revogadas** ao trocar a senha: se a conta foi
 *   comprometida, trocar a senha precisa expulsar quem estava dentro
 */
@Injectable()
export class ResetPasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(NOTIFICATION_SENDER) private readonly notifications: NotificationSender,
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
  ) {}

  /**
   * Etapa 1: gera o token e envia.
   *
   * Sempre devolve sucesso, exista a conta ou não — responder "e-mail não
   * encontrado" transformaria este endpoint num verificador de quem é cliente.
   */
  async request(rawEmail: string): Promise<Result<void>> {
    const email = Email.create(rawEmail);
    if (email.isFail()) return okVoid();

    const user = await this.users.findByEmail(email.value);
    if (!user) return okVoid();

    // Invalida pedidos anteriores: dois links válidos ao mesmo tempo dobram a
    // janela de exposição sem benefício nenhum.
    await this.prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const { token, tokenHash } = this.hash.generateToken();
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
      },
    });

    await this.notifications.send(user.email, {
      kind: 'password-reset',
      token,
      name: user.name,
    });

    return okVoid();
  }

  /**
   * Etapa 2: troca a senha e derruba todas as sessões.
   *
   * @param token - Token em claro, vindo do link do e-mail.
   * @param newPassword - Nova senha, validada pela política do domínio.
   */
  async confirm(token: string, newPassword: string): Promise<Result<void>> {
    const password = Password.create(newPassword);
    if (password.isFail()) return fail(password.error);

    const record = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: this.hash.hashToken(token.trim()) },
    });

    if (!record || record.usedAt !== null || record.expiresAt < new Date()) {
      return fail(new ValidationError('Link inválido ou expirado. Solicite um novo.'));
    }

    const user = await this.users.findById(record.userId);
    if (!user) return fail(new ValidationError('Link inválido ou expirado. Solicite um novo.'));

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordReset.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      await tx.user.update({
        where: { id: record.userId },
        data: { password: await this.hash.hashPassword(password.value.value) },
      });
    });

    await this.refreshTokens.revokeAllForUser(record.userId);
    await this.notifications.send(user.email, { kind: 'password-changed', name: user.name });

    return okVoid();
  }
}
