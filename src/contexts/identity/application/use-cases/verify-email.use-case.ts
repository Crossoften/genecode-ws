import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { HashService } from '@shared/crypto/hash.service';
import { ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';
import { Email } from '../../domain/value-objects/email';
import { TokenIssuer, type IssuedTokens } from '../services/token-issuer.service';

export interface VerifyEmailInput {
  readonly email: string;
  readonly code: string;
  readonly userAgent?: string;
  readonly ipAddress?: string;
}

/** Tentativas antes de o código ser queimado. */
const MAX_ATTEMPTS = 5;

/**
 * Confirma o e-mail com o código de 6 dígitos e já abre a sessão.
 *
 * Abrir a sessão aqui é decisão de produto: a pessoa acabou de provar que
 * controla o endereço, e obrigá-la a digitar a senha logo em seguida é atrito
 * sem ganho de segurança.
 *
 * ### Contagem de tentativas
 *
 * Cada erro incrementa `attempts` no registro. Ao chegar em 5, o código é
 * invalidado e é preciso pedir outro. Sem isso, seis dígitos são 10⁶
 * possibilidades e o rate limit global de 100 req/min levaria uma semana para
 * esgotar — tempo de sobra, já que o código vive 30 minutos, mas o suficiente
 * para um ataque paciente contra muitas contas em paralelo.
 */
@Injectable()
export class VerifyEmailUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
    private readonly tokens: TokenIssuer,
  ) {}

  async execute(input: VerifyEmailInput): Promise<Result<{ tokens: IssuedTokens }>> {
    const email = Email.create(input.email);
    if (email.isFail()) return fail(this.genericFailure());

    const user = await this.users.findByEmail(email.value);
    if (!user) return fail(this.genericFailure());

    const record = await this.prisma.verificationCode.findFirst({
      where: {
        userId: user.id,
        purpose: 'EMAIL_VERIFICATION',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record || record.attempts >= MAX_ATTEMPTS) return fail(this.genericFailure());

    const matches = this.hash.safeCompare(record.codeHash, this.hash.hashToken(input.code.trim()));
    if (!matches) {
      await this.prisma.verificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      return fail(this.genericFailure());
    }

    await this.prisma.verificationCode.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    await this.users.markEmailVerified(user.id);

    // Recarrega para que o token e o principal reflitam o status ACTIVE.
    const activated = await this.users.findById(user.id);
    if (!activated) return fail(this.genericFailure());

    const tokens = await this.tokens.issueFor(activated, {
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    return ok({ tokens });
  }

  /** Mensagem única para código errado, expirado, inexistente ou queimado. */
  private genericFailure(): ValidationError {
    return new ValidationError('Código inválido ou expirado. Solicite um novo.');
  }
}
