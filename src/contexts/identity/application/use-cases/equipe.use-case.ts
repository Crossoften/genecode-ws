import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '@infra/database/prisma.service';
import { HashService } from '@shared/crypto/hash.service';
import { ConflictError, NotFoundError, ValidationError } from '@shared/domain/domain-error';
import { fail, ok, okVoid, type Result } from '@shared/domain/result';

import {
  NOTIFICATION_SENDER,
  type NotificationSender,
} from '../../domain/ports/notification.port';
import { Email } from '../../domain/value-objects/email';

/**
 * Os papéis que a equipe interna pode ter.
 *
 * `patient`, `professional` e `affiliate` ficam de fora de propósito: são
 * papéis de quem usa a plataforma pelo lado de fora, dois deles autoatribuídos
 * no cadastro. Conceder um deles por aqui não faria sentido nenhum, e aceitar
 * um slug qualquer transformaria esta tela numa escada de privilégio.
 */
export const PAPEIS_INTERNOS = ['master', 'admin', 'finance', 'orders', 'lab', 'analytics'] as const;
export type PapelInterno = (typeof PAPEIS_INTERNOS)[number];

export interface MembroDaEquipe {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly papel: string;
  readonly papelNome: string;
  readonly status: string;
  readonly criadoEm: Date;
  /** Ainda não aceitou o convite — a conta existe, mas não entra. */
  readonly aguardandoConvite: boolean;
}

/** Validade do convite de colaborador. */
const CONVITE_TTL_DIAS = 7;

/**
 * A equipe interna e o acesso de cada um.
 *
 * ### De onde veio
 *
 * Call de 09/10. O Augusto pediu o acesso parcial com o caso concreto:
 *
 * > *"Eu preciso botar a pessoa do laboratório para acompanhar esses BIs. (…)
 * > Você não vai dar pro cara de laboratório acesso ao financeiro. Esse cara
 * > não precisa ter, então ele vai ter um acesso parcial com o que diz
 * > respeito a laboratório."*
 *
 * E o André descreveu a tela que faltava: *"você seleciona as pessoas e vai
 * clicando o acesso, né, que são os perfis de financeiro que sabe a parte do
 * financeiro"* — e, sobre a diferença entre master e admin: *"a única coisa
 * que o admin não pode fazer é tirar o acesso do master, porque é a segurança
 * de vocês"*.
 *
 * ### A regra do master
 *
 * Um administrador não mexe em quem é master: não troca o papel, não desativa,
 * não convida outro master. Sem isso, qualquer admin poderia rebaixar a conta
 * que garante o acesso da Genoa à própria plataforma — e seria exatamente o
 * cenário que o cliente nomeou como "a segurança de vocês".
 *
 * Ninguém mexe em si mesmo, nem o master. Tirar o próprio acesso por engano é
 * o jeito mais rápido de ficar de fora do painel sem ninguém para reabrir.
 */
@Injectable()
export class EquipeUseCase {
  private readonly logger = new Logger(EquipeUseCase.name);

  constructor(
    @Inject(NOTIFICATION_SENDER) private readonly notifications: NotificationSender,
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
  ) {}

  /** Quem é da casa, com o papel de cada um. */
  async listar(): Promise<readonly MembroDaEquipe[]> {
    const membros = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        roles: { some: { role: { slug: { in: [...PAPEIS_INTERNOS] } } } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        emailVerifiedAt: true,
        roles: { select: { role: { select: { slug: true, name: true } } } },
      },
    });

    return membros.map((membro) => {
      // Uma conta pode acumular papéis; o que vale para a tela é o mais forte,
      // porque é ele que decide o que a pessoa enxerga.
      const papeis = membro.roles
        .map((vinculo) => vinculo.role)
        .filter((papel): papel is { slug: PapelInterno; name: string } =>
          (PAPEIS_INTERNOS as readonly string[]).includes(papel.slug),
        )
        .sort(
          (a, b) =>
            PAPEIS_INTERNOS.indexOf(a.slug) - PAPEIS_INTERNOS.indexOf(b.slug),
        );
      const principal = papeis[0];
      return {
        id: membro.id,
        name: membro.name,
        email: membro.email,
        papel: principal?.slug ?? '—',
        papelNome: principal?.name ?? '—',
        status: membro.status,
        criadoEm: membro.createdAt,
        aguardandoConvite: membro.status === 'PENDING' && membro.emailVerifiedAt === null,
      };
    });
  }

  /**
   * Convida um colaborador com o papel escolhido.
   *
   * A conta nasce `PENDING`, com senha aleatória que ninguém conhece, e o
   * convite por e-mail é o único caminho para ela virar utilizável — a mesma
   * mecânica do pré-cadastro do checkout, e pelo mesmo motivo: senha
   * provisória previsível é conta invadível.
   */
  async convidar(
    entrada: { readonly name: string; readonly email: string; readonly papel: string },
    ator: { readonly id: string; readonly roles: readonly string[] },
  ): Promise<Result<{ id: string }>> {
    const papel = this.papelValido(entrada.papel);
    if (papel.isFail()) return fail(papel.error);

    if (papel.value === 'master' && !this.ehMaster(ator)) {
      return fail(new ValidationError('Só um master pode criar outro master.'));
    }

    const email = Email.create(entrada.email);
    if (email.isFail()) return fail(email.error);

    const nome = entrada.name.trim();
    if (nome.length < 2) {
      return fail(new ValidationError('Informe o nome do colaborador.', { field: 'name' }));
    }

    const registro = await this.prisma.role.findUnique({ where: { slug: papel.value } });
    if (!registro) return fail(new NotFoundError('Papel não encontrado.'));

    const existente = await this.prisma.user.findFirst({
      where: { email: email.value.value, deletedAt: null },
      select: { id: true, roles: { select: { role: { select: { slug: true } } } } },
    });

    // Conta que já existe (um paciente, por exemplo) ganha o papel novo em vez
    // de virar uma segunda conta com o mesmo e-mail. Quem já é master só é
    // tocado por outro master.
    if (existente) {
      const jaEhMaster = existente.roles.some((vinculo) => vinculo.role.slug === 'master');
      if (jaEhMaster && !this.ehMaster(ator)) {
        return fail(new ValidationError('Só um master pode alterar o acesso de outro master.'));
      }
      await this.prisma.userRole.upsert({
        where: { userId_roleId: { userId: existente.id, roleId: registro.id } },
        update: {},
        create: { userId: existente.id, roleId: registro.id },
      });
      this.logger.log(`Papel ${papel.value} concedido à conta existente ${email.value.value}.`);
      return ok({ id: existente.id });
    }

    const user = await this.prisma.user.create({
      data: {
        email: email.value.value,
        name: nome,
        password: await this.hash.hashPassword(randomBytes(32).toString('hex')),
        status: 'PENDING',
        roles: { create: { roleId: registro.id } },
      },
    });

    await this.enviarConvite(user.id, user.email, user.name);
    this.logger.log(`Colaborador ${user.email} convidado como ${papel.value}.`);
    return ok({ id: user.id });
  }

  /** Troca o papel de alguém da equipe. */
  async trocarPapel(
    membroId: string,
    novoPapel: string,
    ator: { readonly id: string; readonly roles: readonly string[] },
  ): Promise<Result<void>> {
    const papel = this.papelValido(novoPapel);
    if (papel.isFail()) return fail(papel.error);

    const permitido = await this.podeMexer(membroId, ator);
    if (permitido.isFail()) return fail(permitido.error);

    if (papel.value === 'master' && !this.ehMaster(ator)) {
      return fail(new ValidationError('Só um master pode conceder acesso master.'));
    }

    const registro = await this.prisma.role.findUnique({ where: { slug: papel.value } });
    if (!registro) return fail(new NotFoundError('Papel não encontrado.'));

    // Troca, não acumula: a tela mostra um papel por pessoa, e deixar o
    // anterior para trás daria acesso que ninguém vê na tela.
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({
        where: { userId: membroId, role: { slug: { in: [...PAPEIS_INTERNOS] } } },
      }),
      this.prisma.userRole.create({ data: { userId: membroId, roleId: registro.id } }),
    ]);

    this.logger.log(`Papel de ${membroId} alterado para ${papel.value} por ${ator.id}.`);
    return okVoid();
  }

  /** Liga e desliga o acesso de alguém, sem apagar a trilha do que ele fez. */
  async definirAtivo(
    membroId: string,
    ativo: boolean,
    ator: { readonly id: string; readonly roles: readonly string[] },
  ): Promise<Result<void>> {
    const permitido = await this.podeMexer(membroId, ator);
    if (permitido.isFail()) return fail(permitido.error);

    const membro = await this.prisma.user.findUnique({
      where: { id: membroId },
      select: { status: true },
    });
    if (!membro) return fail(new NotFoundError('Colaborador não encontrado.'));

    // Conta que nunca aceitou o convite não "ativa" por aqui: ela ainda não
    // tem senha, e marcá-la ACTIVE criaria uma conta sem credencial nenhuma.
    if (ativo && membro.status === 'PENDING') {
      return fail(
        new ConflictError('Este colaborador ainda não aceitou o convite e criou a senha dele.'),
      );
    }

    await this.prisma.user.update({
      where: { id: membroId },
      data: { status: ativo ? 'ACTIVE' : 'INACTIVE' },
    });

    // Desligar o acesso tem de derrubar quem está dentro: sem isso, a sessão
    // aberta continuaria funcionando até o refresh token vencer.
    if (!ativo) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: membroId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    this.logger.log(`Acesso de ${membroId} ${ativo ? 'reativado' : 'desligado'} por ${ator.id}.`);
    return okVoid();
  }

  /**
   * As duas regras que valem para qualquer alteração.
   *
   * Ninguém mexe em si mesmo, e só master mexe em master. A segunda é literal
   * do cliente: *"a única coisa que o admin não pode fazer é tirar o acesso do
   * master, porque é a segurança de vocês"*.
   */
  private async podeMexer(
    membroId: string,
    ator: { readonly id: string; readonly roles: readonly string[] },
  ): Promise<Result<void>> {
    if (membroId === ator.id) {
      return fail(new ValidationError('Você não pode alterar o seu próprio acesso.'));
    }

    const alvo = await this.prisma.user.findFirst({
      where: { id: membroId, deletedAt: null },
      select: { roles: { select: { role: { select: { slug: true } } } } },
    });
    if (!alvo) return fail(new NotFoundError('Colaborador não encontrado.'));

    const alvoEhMaster = alvo.roles.some((vinculo) => vinculo.role.slug === 'master');
    if (alvoEhMaster && !this.ehMaster(ator)) {
      return fail(new ValidationError('Só um master pode alterar o acesso de outro master.'));
    }

    return okVoid();
  }

  private ehMaster(ator: { readonly roles: readonly string[] }): boolean {
    return ator.roles.includes('master');
  }

  private papelValido(slug: string): Result<PapelInterno> {
    return (PAPEIS_INTERNOS as readonly string[]).includes(slug)
      ? ok(slug as PapelInterno)
      : fail(new ValidationError('Este não é um papel da equipe interna.', { field: 'papel' }));
  }

  private async enviarConvite(userId: string, email: string, name: string): Promise<void> {
    await this.prisma.passwordReset.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    const { token, tokenHash } = this.hash.generateToken();
    await this.prisma.passwordReset.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + CONVITE_TTL_DIAS * 24 * 60 * 60_000),
      },
    });

    await this.notifications.send(email, { kind: 'account-invite', token, name });
  }
}
