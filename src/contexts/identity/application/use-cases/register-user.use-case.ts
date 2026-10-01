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

    // O CPF, antes de criar.
    //
    // Cadastro que **nunca foi confirmado** não prova dono nenhum: ninguém
    // consegue entrar nele (o login recusa conta não verificada), ele não tem
    // laudo, kit nem pedido, e o código de confirmação sempre vai para o e-mail
    // informado agora. Então, quando o CPF bate com uma conta pendente, a coisa
    // certa é deixar a pessoa **recadastrar** — foi o que o André apontou em
    // 01/10: quem errou o próprio e-mail na primeira tentativa não tem outra
    // saída, porque o código foi para uma caixa que não é dele.
    //
    // Conta já confirmada é outra história, e aí vale a recusa.
    const documento = input.document?.replace(/\D/g, '');
    if (documento) {
      const dono = await this.prisma.user.findFirst({
        where: { document: documento, deletedAt: null },
        select: { id: true, emailVerifiedAt: true },
      });

      if (dono?.emailVerifiedAt) {
        // A mensagem **não nomeia o CPF**, de propósito: dizer "este CPF já tem
        // cadastro" transformaria a rota num verificador de quem é cliente do
        // laboratório, que é o mesmo risco que faz o e-mail duplicado responder
        // como se fosse cadastro novo. Num laboratório de genética isso é
        // inferir informação de saúde.
        this.logger.warn(
          `Cadastro recusado: o CPF informado para ${email.value.value} pertence a uma conta confirmada.`,
        );
        return fail(
          new ConflictError(
            'Não foi possível concluir o cadastro com estes dados. ' +
              'Se você já tem conta, entre ou recupere sua senha.',
          ),
        );
      }

      if (dono) {
        return this.recadastrar(dono.id, {
          email: email.value.value,
          passwordHash: await this.hash.hashPassword(password.value.value),
          name,
          input,
        });
      }
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
      // Rede de segurança para a corrida entre a consulta acima e o insert:
      // dois cadastros com o mesmo CPF no mesmo instante. Sem isto, o segundo
      // volta como 500 — que é como este caso se comportava inteiro até 01/10.
      if (!duplicidadeDeDocumento(erro)) throw erro;

      this.logger.warn(
        `Cadastro recusado por corrida: o CPF informado para ${email.value.value} foi gravado por outra requisição.`,
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
   * Recadastro de uma conta que nunca foi confirmada.
   *
   * Sobrescreve e-mail, nome, senha e telefone da conta pendente que já tem
   * aquele CPF, e manda um código novo. É o caminho de quem digitou o próprio
   * e-mail errado: o código foi para uma caixa que não é dele, e sem isto não há
   * como corrigir — o CPF trava o cadastro novo e a conta velha é inalcançável.
   *
   * Três cuidados:
   *
   * - **a resposta é idêntica à de um cadastro novo**, então nada aqui revela
   *   que aquele CPF já tinha passado pela plataforma;
   * - **o código anterior é invalidado**, senão o que foi para o e-mail errado
   *   continuaria valendo pelos 30 minutos;
   * - **o aceite dos documentos é gravado de novo**, com a versão vigente agora.
   *   A tentativa anterior consentiu numa sessão que não se concluiu; o que vale
   *   é o aceite desta.
   */
  private async recadastrar(
    userId: string,
    dados: {
      readonly email: string;
      readonly passwordHash: string;
      readonly name: string;
      readonly input: RegisterUserInput;
    },
  ): Promise<Result<RegisterUserOutput>> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          email: dados.email,
          name: dados.name,
          password: dados.passwordHash,
          phone: dados.input.phone,
          status: 'PENDING',
        },
      });
    } catch (erro) {
      // O e-mail novo pertence a outra conta. Responde como o caminho de e-mail
      // duplicado — igual a um cadastro novo, sem dizer o que aconteceu.
      if (!duplicidadeDeEmail(erro)) throw erro;
      this.logger.warn(`Recadastro abortado: ${dados.email} já pertence a outra conta.`);
      return ok({ userId, verificationSent: true });
    }

    await this.recordConsents(userId, dados.input);
    await this.assignPatientRole(userId);

    await this.prisma.verificationCode.updateMany({
      where: { userId, purpose: 'EMAIL_VERIFICATION', usedAt: null },
      data: { usedAt: new Date() },
    });

    const { code, codeHash } = this.hash.generateNumericCode(6);
    await this.prisma.verificationCode.create({
      data: {
        userId,
        purpose: 'EMAIL_VERIFICATION',
        codeHash,
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60_000),
      },
    });

    await this.notifications.send(dados.email, {
      kind: 'email-verification',
      code,
      name: dados.name,
    });

    this.logger.log(`Recadastro de conta pendente ${userId} com o e-mail ${dados.email}.`);

    return this.exporCodigo()
      ? ok({ userId, verificationSent: true, codigoDeTeste: code })
      : ok({ userId, verificationSent: true });
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
    // `upsert`, e não `create`: no recadastro a conta já tem o papel, e o
    // `create` quebraria na chave composta.
    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id },
    });
  }
}

/** O erro é a violação da unicidade de `document`? */
function duplicidadeDeDocumento(erro: unknown): boolean {
  return violacaoDeUnicidade(erro, 'document');
}

/** O erro é a violação da unicidade de `email`? */
function duplicidadeDeEmail(erro: unknown): boolean {
  return violacaoDeUnicidade(erro, 'email');
}

/**
 * O erro do Prisma é uma violação de unicidade naquele campo?
 *
 * Checado pelo código `P2002` e pelo alvo que o Prisma devolve, e não pelo texto
 * da mensagem: texto de biblioteca muda entre versões, e um `includes` nele
 * passaria a deixar o 500 voltar em silêncio no dia da atualização.
 */
function violacaoDeUnicidade(erro: unknown, campo: string): boolean {
  if (typeof erro !== 'object' || erro === null) return false;

  const { code, meta } = erro as { code?: unknown; meta?: { target?: unknown } };
  if (code !== 'P2002') return false;

  const alvo = meta?.target;
  const campos = Array.isArray(alvo) ? alvo : typeof alvo === 'string' ? [alvo] : [];
  return campos.some((nome) => String(nome).includes(campo));
}
