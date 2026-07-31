import { Inject, Injectable } from '@nestjs/common';

import { UnauthenticatedError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';
import { HashService } from '@shared/crypto/hash.service';

import { Email } from '../../domain/value-objects/email';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';
import { TokenIssuer, type IssuedTokens } from '../services/token-issuer.service';

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

export interface AuthenticateOutput {
  readonly user: AuthenticatedUser;
  readonly tokens: IssuedTokens;
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
  ) {}

  /**
   * @param input - Credentials plus request metadata used to label the session.
   * @returns The authenticated user and a fresh token pair, or an
   *   `UnauthenticatedError` that is intentionally identical for every cause.
   */
  async execute(input: AuthenticateInput): Promise<Result<AuthenticateOutput>> {
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

    if (user.status !== 'ACTIVE') return fail(this.genericFailure());

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
