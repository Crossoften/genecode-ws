import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { Env } from '@shared/config/env.schema';
import { HashService } from '@shared/crypto/hash.service';

import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../../domain/ports/refresh-token.repository';
import type { UserRecord } from '../../domain/ports/user.repository';

export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: string;
}

export interface SessionMetadata {
  readonly userAgent?: string;
  readonly ipAddress?: string;
}

/**
 * Claims carried by the access token.
 *
 * Note what is *not* here: roles and permissions. The old backend embedded the
 * role in a 360-day JWT, so demoting an admin changed nothing for up to a year.
 * Authorisation reads from the database on each request instead — a lookup by
 * primary key, cheap enough to not be worth the staleness.
 */
export interface AccessTokenClaims {
  readonly sub: string;
  readonly email: string;
}

/**
 * Issues and rotates the access/refresh pair.
 *
 * Lives in `application` rather than `domain` because it depends on JWT signing,
 * which is an infrastructure concern — but it is not a use case either, since
 * login, refresh and signup all reuse it.
 */
@Injectable()
export class TokenIssuer {
  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    private readonly jwt: JwtService,
    private readonly hash: HashService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Issues a fresh token pair and opens a new session row.
   *
   * @param user - The already-authenticated user.
   * @param metadata - Request context stored alongside the session so the user
   *   can later recognise and revoke it.
   */
  async issueFor(user: UserRecord, metadata: SessionMetadata = {}): Promise<IssuedTokens> {
    const accessToken = await this.signAccessToken(user);
    const { token, tokenHash } = this.hash.generateToken();

    await this.refreshTokens.issue({
      userId: user.id,
      tokenHash,
      expiresAt: this.refreshExpiry(),
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
    });

    return {
      accessToken,
      refreshToken: token,
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    };
  }

  /**
   * Rotates an existing session: the old refresh token is revoked and a new pair
   * is issued in the same transaction.
   *
   * @param currentTokenId - Row id of the token being exchanged.
   * @param user - Owner of the session, re-read so a deactivated account cannot
   *   keep refreshing.
   */
  async rotate(
    currentTokenId: string,
    user: UserRecord,
    metadata: SessionMetadata = {},
  ): Promise<IssuedTokens> {
    const accessToken = await this.signAccessToken(user);
    const { token, tokenHash } = this.hash.generateToken();

    await this.refreshTokens.rotate(currentTokenId, {
      userId: user.id,
      tokenHash,
      expiresAt: this.refreshExpiry(),
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
    });

    return {
      accessToken,
      refreshToken: token,
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    };
  }

  private async signAccessToken(user: UserRecord): Promise<string> {
    const claims: AccessTokenClaims = { sub: user.id, email: user.email };
    return this.jwt.signAsync(claims, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    });
  }

  private refreshExpiry(): Date {
    const days = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
}
