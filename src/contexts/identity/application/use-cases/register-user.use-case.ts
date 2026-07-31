import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { ConflictError } from '@shared/domain/domain-error';
import { HashService } from '@shared/crypto/hash.service';
import { fail, ok, type Result } from '@shared/domain/result';

import {
  NOTIFICATION_SENDER,
  type NotificationSender,
} from '../../domain/ports/notification.port';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';
import { Email } from '../../domain/value-objects/email';
import { Password } from '../../domain/value-objects/password';

export interface RegisterUserInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly document?: string;
  readonly phone?: string;
  /** Versões dos documentos legais que a pessoa aceitou na tela. */
  readonly acceptedConsents: readonly { type: string; version: string }[];
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface RegisterUserOutput {
  readonly userId: string;
  /** Sempre true — o cadastro não confirma se o e-mail já existia. */
  readonly verificationSent: boolean;
}

/** Validade do código de verificação. Curto o bastante para limitar reuso. */
const VERIFICATION_TTL_MINUTES = 30;

/**
 * Cria uma conta e dispara o código de verificação.
 *
 * A conta nasce em `PENDING` e só vira `ACTIVE` quando o e-mail é confirmado.
 * Enquanto isso ela não autentica — o `AuthenticateUseCase` recusa qualquer
 * status diferente de `ACTIVE`.
 *
 * ### Por que o e-mail duplicado não retorna erro
 *
 * Se responder "e-mail já cadastrado", qualquer pessoa descobre quem é cliente
 * da plataforma testando endereços. Num laboratório de genética isso revela
 * informação de saúde por inferência.
 *
 * Então a resposta é idêntica nos dois casos, e quem já tem conta recebe um
 * e-mail avisando que houve uma tentativa de cadastro — que é a informação útil
 * para quem é dono do endereço, e inútil para quem está sondando.
 */
@Injectable()
export class RegisterUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(NOTIFICATION_SENDER) private readonly notifications: NotificationSender,
    private readonly hash: HashService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: RegisterUserInput): Promise<Result<RegisterUserOutput>> {
    const email = Email.create(input.email);
    if (email.isFail()) return fail(email.error);

    const password = Password.create(input.password);
    if (password.isFail()) return fail(password.error);

    const name = input.name.trim();
    if (name.length < 2) {
      return fail(new ConflictError('Informe seu nome completo.', { field: 'name' }));
    }

    const existing = await this.users.findByEmail(email.value);
    if (existing) {
      // Resposta indistinguível da de um cadastro novo. Ver nota acima.
      await this.notifications.send(email.value.value, {
        kind: 'email-verification',
        code: '', // sem código: a conta já existe, é só um aviso
        name: existing.name,
      });
      return ok({ userId: existing.id, verificationSent: true });
    }

    const user = await this.users.create({
      email: email.value.value,
      passwordHash: await this.hash.hashPassword(password.value.value),
      name,
      document: input.document,
      phone: input.phone,
    });

    await this.recordConsents(user.id, input);
    await this.assignPatientRole(user.id);

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
      name,
    });

    return ok({ userId: user.id, verificationSent: true });
  }

  /**
   * Grava o aceite dos documentos legais.
   *
   * Com IP, user-agent e a versão exata do texto aceito. É o que permite provar,
   * anos depois, a que a pessoa consentiu — requisito da LGPD para dado genético,
   * que é dado pessoal sensível.
   */
  private async recordConsents(userId: string, input: RegisterUserInput): Promise<void> {
    for (const accepted of input.acceptedConsents) {
      const document = await this.prisma.consentDocument.findFirst({
        where: { type: accepted.type as never, version: accepted.version },
      });
      if (!document) continue;

      await this.prisma.consent.create({
        data: {
          userId,
          documentId: document.id,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
    }
  }

  /** Todo cadastro pela vitrine nasce como paciente. */
  private async assignPatientRole(userId: string): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { slug: 'patient' } });
    if (!role) return;
    await this.prisma.userRole.create({ data: { userId, roleId: role.id } });
  }
}
