import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '@infra/database/prisma.service';
import type { Env } from '@shared/config/env.schema';
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
  /**
   * O código, e só quando `MOSTRAR_CODIGO_VERIFICACAO=YES`.
   *
   * Existe para ambiente sem e-mail, onde o código não chegaria a ninguém e o
   * cadastro ficaria impossível de concluir. Fora daí é sempre indefinido.
   */
  readonly codigoDeTeste?: string;
}

/** Validade do código de verificação. Curto o bastante para limitar reuso. */
/** Validade do código de verificação. Exportada: o reenvio usa a mesma. */
export const VERIFICATION_TTL_MINUTES = 30;

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
    private readonly config: ConfigService<Env, true>,
  ) {}

  private readonly logger = new Logger(RegisterUserUseCase.name);

  /** Liga só com a chave explícita — ver a nota no schema de ambiente. */
  private exporCodigo(): boolean {
    return this.config.get('MOSTRAR_CODIGO_VERIFICACAO', { infer: true }) === 'YES';
  }

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

    let user;
    try {
      user = await this.users.create({
        email: email.value.value,
        passwordHash: await this.hash.hashPassword(password.value.value),
        name,
        document: input.document,
        phone: input.phone,
      });
    } catch (erro) {
      // `document` é único no banco, e até 01/10/2026 ninguém tratava a
      // violação: o segundo cadastro com o mesmo CPF e um e-mail novo devolvia
      // **500** ("Erro interno. Tente novamente em instantes."). A pessoa
      // repetia para sempre, e nada na tela indicava qual campo era o problema.
      //
      // A mensagem **não nomeia o CPF**, de propósito. Dizer "este CPF já tem
      // cadastro" transformaria a rota num verificador de quem é cliente do
      // laboratório — o mesmo risco que fez o e-mail duplicado responder como
      // se fosse cadastro novo, e num laboratório de genética isso é inferir
      // informação de saúde. Decidir se o ganho de usabilidade compensa esse
      // vazamento é da Genoa, não nossa: até lá, o erro é genérico e o log
      // guarda o detalhe para o suporte conseguir explicar.
      if (!duplicidadeDeDocumento(erro)) throw erro;

      this.logger.warn(
        `Cadastro recusado: o CPF informado para ${email.value.value} já pertence a outra conta.`,
      );
      return fail(
        new ConflictError(
          'Não foi possível concluir o cadastro com estes dados. ' +
            'Se você já tem conta, entre ou recupere sua senha.',
        ),
      );
    }

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

    if (this.exporCodigo()) {
      this.logger.warn(
        `Código de verificação devolvido na resposta para ${email.value.value} — ` +
          'MOSTRAR_CODIGO_VERIFICACAO está ligado. Isto não deve valer em produção.',
      );
      return ok({ userId: user.id, verificationSent: true, codigoDeTeste: code });
    }

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

/**
 * O erro é a violação da unicidade de `document`?
 *
 * Checado pelo código `P2002` e pelo alvo que o Prisma devolve, e não pelo texto
 * da mensagem: texto de biblioteca muda entre versões, e um `includes` nele
 * passaria a deixar o 500 voltar em silêncio no dia da atualização.
 */
function duplicidadeDeDocumento(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false;

  const { code, meta } = erro as { code?: unknown; meta?: { target?: unknown } };
  if (code !== 'P2002') return false;

  const alvo = meta?.target;
  const campos = Array.isArray(alvo) ? alvo : typeof alvo === 'string' ? [alvo] : [];
  return campos.some((campo) => String(campo).includes('document'));
}
