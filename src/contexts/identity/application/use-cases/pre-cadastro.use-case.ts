import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '@infra/database/prisma.service';
import { HashService } from '@shared/crypto/hash.service';
import { fail, ok, type Result } from '@shared/domain/result';
import { ValidationError } from '@shared/domain/domain-error';

import {
  NOTIFICATION_SENDER,
  type NotificationSender,
} from '../../domain/ports/notification.port';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';
import { Email } from '../../domain/value-objects/email';
import { Password } from '../../domain/value-objects/password';
import { TokenIssuer, type IssuedTokens } from '../services/token-issuer.service';

export interface PreCadastroInput {
  readonly name: string;
  readonly email: string;
  readonly document?: string;
  readonly phone?: string;
  /** Endereço de contato do perfil — o de entrega continua congelado no pedido. */
  readonly addressLine?: string;
  readonly addressZip?: string;
}

/**
 * Validade do convite.
 *
 * Sete dias, e não os 30 minutos da recuperação de senha: aqui não há um
 * pedido recém-feito do outro lado da tela esperando o e-mail. A pessoa
 * comprou, vai receber o kit em alguns dias, e é quando o kit chega que ela
 * lembra de criar a conta.
 */
const CONVITE_TTL_DIAS = 7;

/**
 * Pré-cadastro de quem comprou sem conta.
 *
 * ### O que a reunião de 09/10 decidiu
 *
 * A compra não exige login — isso já era verdade desde 28/05. O que faltava
 * era o outro lado: quem comprou sem conta **não existia** na plataforma, e os
 * dados dele morriam congelados dentro do pedido.
 *
 * O Augusto defendeu o histórico de compras: *"eu acho tão importante você ter
 * esse histórico aí… o que vale hoje é o banco de dados, não é só de quem
 * realiza o exame, mas de quem compra também"*. O Flávio e o Camara
 * defenderam não obrigar ninguém a criar conta: *"tem muita gente que acha um
 * saco, pô, já tá pedindo para eu fazer conta, e o cara pula fora"*. O meio
 * termo saiu assim, com estas palavras:
 *
 * > *"A gente faz um pré-cadastro, a gente não precisa do campo de login,
 * > senha — a gente pede o e-mail da pessoa… manda o e-mail para ela, chega o
 * > e-mail lá de cadastro convidando a pessoa a se cadastrar, e aí aparece os
 * > campos para ela colocar o login e senha. Aí a gente faz esse pré-cadastro
 * > e vincula a compra nesse pré-cadastro. Pro usuário ele nunca viu que ele
 * > fez cadastro, mas se ele clica no link para formalizar o cadastro, aí vai
 * > tá tudo já pré-preenchido."*
 *
 * E o Norton completou o motivo que não é de marketing: *"se ele contestar
 * essa compra, a gente tem que provar que essa compra foi feita"* — CPF,
 * telefone e e-mail precisam estar ligados a alguém, não soltos num pedido.
 *
 * ### Como funciona
 *
 * A conta nasce `PENDING`, com uma senha aleatória que **ninguém conhece** —
 * nem a pessoa, nem nós. Ela não autentica (o login recusa conta não ativa) e
 * só vira utilizável quando o convite é aceito e uma senha de verdade é
 * definida. Sem isso, a alternativa seria gravar uma senha previsível, e conta
 * com senha previsível é conta invadível.
 *
 * E-mail que já tem conta não vira nada: o pedido é vinculado à conta
 * existente e nenhuma mensagem é enviada. Mandar "complete seu cadastro" para
 * quem já é cliente confunde, e responder diferente para e-mail conhecido
 * transformaria o checkout num verificador de quem é cliente do laboratório.
 */
@Injectable()
export class PreCadastroUseCase {
  private readonly logger = new Logger(PreCadastroUseCase.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(NOTIFICATION_SENDER) private readonly notifications: NotificationSender,
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
    private readonly tokens: TokenIssuer,
  ) {}

  /**
   * Garante uma conta para o comprador e devolve o id, para o pedido ser
   * vinculado a ela.
   *
   * Nunca lança: o checkout não pode falhar porque o pré-cadastro falhou. Uma
   * compra paga vale mais do que o vínculo, e o vínculo pode ser refeito.
   * Devolve `null` quando não deu, e o pedido segue anônimo como antes.
   */
  async garantirConta(input: PreCadastroInput): Promise<string | null> {
    try {
      const email = Email.create(input.email);
      if (email.isFail()) return null;

      const existente = await this.users.findByEmail(email.value);
      if (existente) return existente.id;

      // CPF já cadastrado em outra conta: não dá para criar, e também não dá
      // para dizer de quem é. O pedido segue sem vínculo.
      const documento = input.document?.replace(/\D/g, '');
      if (documento) {
        const dono = await this.prisma.user.findFirst({
          where: { document: documento, deletedAt: null },
          select: { id: true },
        });
        if (dono) return dono.id;
      }

      const user = await this.users.create({
        email: email.value.value,
        // Senha que ninguém conhece. A conta não autentica enquanto está
        // PENDING, e o convite é o único caminho para definir uma de verdade.
        passwordHash: await this.hash.hashPassword(randomBytes(32).toString('hex')),
        name: input.name.trim(),
        document: input.document,
        phone: input.phone,
      });

      if (input.addressLine || input.addressZip) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { addressLine: input.addressLine, addressZip: input.addressZip },
        });
      }

      await this.atribuirPapelPaciente(user.id);
      await this.enviarConvite(user.id, email.value.value, user.name);

      this.logger.log(`Pré-cadastro criado para ${email.value.value} a partir do checkout.`);
      return user.id;
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'desconhecido';
      this.logger.error(`Pré-cadastro falhou (${motivo}). O pedido segue sem conta vinculada.`);
      return null;
    }
  }

  /**
   * O que a tela do convite mostra antes de pedir a senha.
   *
   * Resposta única para token inválido, expirado, usado ou de conta que já foi
   * ativada: quem tem o link não precisa saber em qual dos casos caiu, e a
   * diferença viraria um oráculo de e-mails cadastrados.
   */
  async consultar(token: string): Promise<Result<{ name: string; email: string }>> {
    const registro = await this.registroValido(token);
    if (!registro) return fail(this.conviteInvalido());

    const user = await this.prisma.user.findUnique({
      where: { id: registro.userId },
      select: { name: true, email: true, status: true },
    });
    if (!user || user.status !== 'PENDING') return fail(this.conviteInvalido());

    return ok({ name: user.name, email: user.email });
  }

  /**
   * Conclui o cadastro: define a senha, ativa a conta e já abre a sessão.
   *
   * Abrir a sessão aqui segue a mesma decisão da confirmação de e-mail: a
   * pessoa acabou de provar que controla o endereço (o link chegou nele), e
   * pedir a senha recém-criada logo em seguida é atrito sem ganho.
   *
   * O e-mail é dado como verificado pelo mesmo motivo — o convite foi para ele
   * e ninguém mais poderia estar aqui.
   */
  async concluir(
    token: string,
    senha: string,
    contexto: { userAgent?: string; ipAddress?: string },
  ): Promise<Result<{ tokens: IssuedTokens }>> {
    const password = Password.create(senha);
    if (password.isFail()) return fail(password.error);

    const registro = await this.registroValido(token);
    if (!registro) return fail(this.conviteInvalido());

    const user = await this.users.findById(registro.userId);
    if (!user || user.status !== 'PENDING') return fail(this.conviteInvalido());

    const passwordHash = await this.hash.hashPassword(password.value.value);
    await this.prisma.$transaction([
      this.prisma.passwordReset.update({
        where: { id: registro.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: registro.userId },
        data: { password: passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
      }),
    ]);

    const ativo = await this.users.findById(registro.userId);
    if (!ativo) return fail(this.conviteInvalido());

    const tokens = await this.tokens.issueFor(ativo, contexto);
    this.logger.log(`Convite de pré-cadastro concluído por ${ativo.email}.`);
    return ok({ tokens });
  }

  /**
   * O convite viaja na mesma tabela da recuperação de senha.
   *
   * É o mesmo objeto: um token opaco de uso único, com prazo, que autoriza
   * definir uma senha. Criar uma segunda tabela idêntica significaria manter
   * duas regras de expiração e de uso único — e é sempre a segunda que fica
   * para trás.
   */
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

  private async registroValido(token: string) {
    const registro = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: this.hash.hashToken(token.trim()) },
    });
    if (!registro || registro.usedAt !== null || registro.expiresAt < new Date()) return null;
    return registro;
  }

  private conviteInvalido(): ValidationError {
    return new ValidationError(
      'Este convite não vale mais. Se você já criou sua senha, é só entrar; ' +
        'se não, use "Esqueci minha senha" com o e-mail da compra.',
    );
  }

  /**
   * Papel de paciente, como no cadastro normal.
   *
   * Sem ele a pessoa entra e não enxerga a própria área — e o pré-cadastro
   * existe justamente para ela ver o histórico da compra quando entrar.
   */
  private async atribuirPapelPaciente(userId: string): Promise<void> {
    const papel = await this.prisma.role.findUnique({ where: { slug: 'patient' } });
    if (!papel) {
      this.logger.error('Papel "patient" não existe: o pré-cadastro ficou sem papel.');
      return;
    }
    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: papel.id } },
      update: {},
      create: { userId, roleId: papel.id },
    });
  }
}
