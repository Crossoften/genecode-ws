import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VerificationPurpose } from '@prisma/client';

import { PrismaService } from '@infra/database/prisma.service';
import type { Env } from '@shared/config/env.schema';
import { HashService } from '@shared/crypto/hash.service';
import { ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import {
  NOTIFICATION_SENDER,
  type IdentityNotification,
  type NotificationSender,
} from '../../domain/ports/notification.port';

/** Tentativas antes de o código ser queimado, igual em todos os propósitos. */
const MAX_ATTEMPTS = 5;

export interface AbrirDesafioInput {
  readonly userId: string;
  readonly purpose: VerificationPurpose;
  readonly email: string;
  readonly name: string;
  readonly ttlMinutes: number;
  /** A notificação a enviar, já com o código dentro. */
  readonly notificacao: (code: string) => IdentityNotification;
}

export interface DesafioAberto {
  readonly challengeId: string;
  /** `pa•••••@email.com` — o bastante para saber onde procurar. */
  readonly maskedEmail: string;
  readonly expiresInSeconds: number;
  /** Só com MOSTRAR_CODIGO_VERIFICACAO=YES; nunca em produção. */
  readonly codigoDeTeste?: string;
}

/**
 * Código de uso único por e-mail, para qualquer ato que precise de confirmação.
 *
 * Existe porque a mesma mecânica — gerar seis dígitos, guardar só o hash,
 * contar tentativas, expirar, queimar ao usar — vale para a segunda etapa da
 * entrada e para a troca de dados de repasse, e cada cópia dessa lógica é uma
 * chance a mais de alguém esquecer o teto de tentativas.
 *
 * O que ela deliberadamente **não** faz é decidir o que acontece depois de o
 * código conferir: quem abre sessão é o `TwoFactorUseCase`, quem grava dados
 * bancários é o controller do parceiro.
 */
@Injectable()
export class VerificationChallengeService {
  private readonly logger = new Logger(VerificationChallengeService.name);

  constructor(
    @Inject(NOTIFICATION_SENDER) private readonly notifications: NotificationSender,
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Abre um desafio e manda o código.
   *
   * Invalida os desafios anteriores do mesmo propósito para a mesma conta. Sem
   * isso, cada "reenviar" somaria um código vivo a mais para adivinhar.
   */
  async abrir(input: AbrirDesafioInput): Promise<DesafioAberto> {
    await this.prisma.verificationCode.updateMany({
      where: { userId: input.userId, purpose: input.purpose, usedAt: null },
      data: { usedAt: new Date() },
    });

    const { code, codeHash } = this.hash.generateNumericCode(6);
    const registro = await this.prisma.verificationCode.create({
      data: {
        userId: input.userId,
        purpose: input.purpose,
        codeHash,
        expiresAt: new Date(Date.now() + input.ttlMinutes * 60_000),
      },
    });

    await this.notifications.send(input.email, input.notificacao(code));

    const desafio: DesafioAberto = {
      challengeId: registro.id,
      maskedEmail: mascarar(input.email),
      expiresInSeconds: input.ttlMinutes * 60,
    };

    if (this.exporCodigo()) {
      this.logger.warn(
        `Código ${input.purpose} devolvido na resposta para ${input.email} — ` +
          'MOSTRAR_CODIGO_VERIFICACAO está ligado. Isto não deve valer em produção.',
      );
      return { ...desafio, codigoDeTeste: code };
    }

    return desafio;
  }

  /**
   * Confere o código e queima o desafio.
   *
   * @returns O `userId` do dono do desafio, para quem chamou decidir o que
   *   fazer em nome dele. Erro único para código errado, expirado, já usado,
   *   queimado ou de outro propósito — distinguir ajudaria só quem adivinha.
   */
  async consumir(
    challengeId: string,
    purpose: VerificationPurpose,
    code: string,
  ): Promise<Result<{ userId: string }>> {
    const registro = await this.prisma.verificationCode.findFirst({
      where: { id: challengeId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    });

    if (!registro || registro.attempts >= MAX_ATTEMPTS) return fail(this.recusa());

    const confere = this.hash.safeCompare(registro.codeHash, this.hash.hashToken(code.trim()));
    if (!confere) {
      await this.prisma.verificationCode.update({
        where: { id: registro.id },
        data: { attempts: { increment: 1 } },
      });
      return fail(this.recusa());
    }

    await this.prisma.verificationCode.update({
      where: { id: registro.id },
      data: { usedAt: new Date() },
    });

    return ok({ userId: registro.userId });
  }

  private recusa(): ValidationError {
    return new ValidationError('Código inválido ou expirado. Peça um novo.');
  }

  /** Mesma chave e mesmo valor que o cadastro usa — 'YES', não booleano. */
  private exporCodigo(): boolean {
    return this.config.get('MOSTRAR_CODIGO_VERIFICACAO', { infer: true }) === 'YES';
  }
}

/** `parceiro@email.com` → `pa•••••@email.com`. */
export function mascarar(email: string): string {
  const arroba = email.indexOf('@');
  if (arroba < 1) return email;
  const local = email.slice(0, arroba);
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(3, local.length - 2))}${email.slice(arroba)}`;
}
