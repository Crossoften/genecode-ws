import { Inject, Injectable } from '@nestjs/common';

import { UnauthenticatedError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';
import { HashService } from '@shared/crypto/hash.service';

import { Email } from '../../domain/value-objects/email';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';
import { TokenIssuer, type IssuedTokens } from '../services/token-issuer.service';
import { TwoFactorUseCase } from './two-factor.use-case';

export interface AuthenticateInput {
  readonly email: string;
  readonly password: string;
  readonly userAgent?: string;
  readonly ipAddress?: string;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

/**
 * Senha conferiu e a sessão está aberta.
 *
 * `twoFactorRequired` fica ausente ou `false` — o cliente distingue os dois
 * casos por este campo, não pela presença do token.
 */
export interface AuthenticateOutput {
  readonly twoFactorRequired?: false;
  readonly user: AuthenticatedUser;
  readonly tokens: IssuedTokens;
}

/**
 * Senha conferiu, mas **nenhuma sessão foi aberta**: falta a segunda etapa.
 *
 * Não há token aqui de propósito. Até 07/10 o login devolvia o par de tokens
 * para todo mundo e a tela do código era encenação — bastava não digitar e
 * navegar direto para o painel.
 */
export interface TwoFactorRequiredOutput {
  readonly twoFactorRequired: true;
  readonly challengeId: string;
  readonly maskedEmail: string;
  readonly expiresInSeconds: number;
  readonly codigoDeTeste?: string;
}

/**
 * Signs a user in with email and password.
 *
 * Every failure path returns the same generic error. Distinguishing "no such
 * account" from "wrong password" would let anyone enumerate which emails are
 * registered — which, for a genetics platform, discloses that a person is a
 * customer.
 */
@Injectable()
export class AuthenticateUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly hash: HashService,
    private readonly tokens: TokenIssuer,
    private readonly twoFactor: TwoFactorUseCase,
  ) {}

  /**
   * @param input - Credentials plus request metadata used to label the session.
   * @returns The authenticated user and a fresh token pair, or an
   *   `UnauthenticatedError` that is intentionally identical for every cause.
   */
  async execute(
    input: AuthenticateInput,
  ): Promise<Result<AuthenticateOutput | TwoFactorRequiredOutput>> {
    const email = Email.create(input.email);
    if (email.isFail()) return fail(this.genericFailure());

    const user = await this.users.findByEmail(email.value);

    // Hash a throwaway value when the account does not exist so that the
    // response time does not reveal whether the email is registered.
    if (!user) {
      await this.hash.verifyPassword(input.password, DUMMY_HASH);
      return fail(this.genericFailure());
    }

    const passwordMatches = await this.hash.verifyPassword(input.password, user.passwordHash);
    if (!passwordMatches) return fail(this.genericFailure());

    // Aqui a senha JÁ conferiu. Continuar respondendo "e-mail ou senha
    // inválidos" não protege nada — quem chegou até aqui provou que sabe a
    // senha — e manda a pessoa tentar de novo para sempre. Foi exatamente o que
    // travou o cliente em 29/09: a conta existia, a senha estava certa, e a
    // mensagem dizia que estavam errados.
    //
    // A resposta genérica continua valendo para e-mail inexistente e senha
    // errada, que é onde a enumeração aconteceria.
    if (user.status === 'PENDING') {
      return fail(
        new UnauthenticatedError(
          'Sua conta ainda não foi verificada. Confirme o código enviado para o seu e-mail.',
        ),
      );
    }
    if (user.status !== 'ACTIVE') return fail(this.genericFailure());

    // A senha conferiu, mas a conta pode exigir a segunda etapa. Daqui não sai
    // token: sai um desafio, e o par de tokens só nasce em TwoFactorUseCase.
    // .verify(). É o que impede pular a tela do código.
    if (this.twoFactor.requiresSecondStep(user)) {
      const desafio = await this.twoFactor.startChallenge(user);
      return ok({ twoFactorRequired: true, ...desafio });
    }

    const tokens = await this.tokens.issueFor(user, {
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    return ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.roles,
        permissions: user.permissions,
      },
      tokens,
    });
  }

  private genericFailure(): UnauthenticatedError {
    return new UnauthenticatedError('E-mail ou senha inválidos.');
  }
}

/**
 * A real bcrypt hash of a random string, used only to burn the same CPU time as
 * a genuine verification would. Never matches any password.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3Vk1S7uJH9YvZ3sQ0bXK8kL5mNpQrSu';
