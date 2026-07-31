import { Inject, Injectable, Logger } from '@nestjs/common';

import { HashService } from '@shared/crypto/hash.service';
import { UnauthenticatedError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../../domain/ports/refresh-token.repository';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';
import { TokenIssuer, type IssuedTokens } from '../services/token-issuer.service';

export interface RefreshSessionInput {
  readonly refreshToken: string;
  readonly userAgent?: string;
  readonly ipAddress?: string;
}

/**
 * Renova a sessão, rotacionando o refresh token.
 *
 * ### Detecção de reuso
 *
 * Cada refresh queima o token usado e emite outro. Se um token **já rotacionado**
 * reaparece, só há duas explicações: ou ele foi roubado e o atacante está usando,
 * ou foi roubado e o legítimo está usando depois do atacante. Em qualquer dos
 * casos alguém tem uma cópia que não deveria ter.
 *
 * A resposta é derrubar **todas** as sessões do usuário. É agressivo — a pessoa
 * precisa entrar de novo em todos os dispositivos — mas é o único jeito de
 * expulsar quem não deveria estar dentro, e num sistema com laudo genético o
 * incômodo vale a pena.
 */
@Injectable()
export class RefreshSessionUseCase {
  private readonly logger = new Logger(RefreshSessionUseCase.name);

  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly hash: HashService,
    private readonly tokens: TokenIssuer,
  ) {}

  async execute(input: RefreshSessionInput): Promise<Result<{ tokens: IssuedTokens }>> {
    const record = await this.refreshTokens.findByHash(
      this.hash.hashToken(input.refreshToken.trim()),
    );

    if (!record) return fail(this.expired());

    // Token já rotacionado reaparecendo: cópia em circulação.
    if (record.replacedById !== null) {
      this.logger.warn(
        `Reuso de refresh token detectado para o usuário ${record.userId}. Revogando sessões.`,
      );
      await this.refreshTokens.revokeAllForUser(record.userId);
      return fail(this.expired());
    }

    if (record.revokedAt !== null || record.expiresAt < new Date()) {
      return fail(this.expired());
    }

    // Relê o usuário: conta desativada ou papel rebaixado precisa valer já no
    // próximo access token, não só quando o atual expirar.
    const user = await this.users.findById(record.userId);
    if (!user || user.status !== 'ACTIVE') return fail(this.expired());

    const tokens = await this.tokens.rotate(record.id, user, {
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    return ok({ tokens });
  }

  private expired(): UnauthenticatedError {
    return new UnauthenticatedError('Sessão expirada. Entre novamente.');
  }
}
