/** Injection token — the domain never names a concrete implementation. */
export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');

export interface RefreshTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedById: string | null;
}

export interface IssueRefreshTokenInput {
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly userAgent?: string;
  readonly ipAddress?: string;
}

/**
 * Persistence boundary for refresh sessions.
 *
 * Sessions live in the database rather than only inside a JWT so that logging
 * out, deactivating an account or demoting an admin takes effect immediately.
 */
export interface RefreshTokenRepository {
  /** Stores a newly issued refresh token. */
  issue(input: IssueRefreshTokenInput): Promise<RefreshTokenRecord>;

  /** Looks a token up by its SHA-256 hash. */
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;

  /**
   * Atomically revokes `oldId` and issues its replacement.
   *
   * Must run in a transaction: a crash between the two writes would either leave
   * two live tokens or lock the user out.
   */
  rotate(oldId: string, next: IssueRefreshTokenInput): Promise<RefreshTokenRecord>;

  /**
   * Revokes every live session for a user.
   *
   * Called on logout-everywhere, password change, and on detecting reuse of an
   * already-rotated token — which means the token was stolen.
   */
  revokeAllForUser(userId: string): Promise<void>;

  /** Deletes expired rows. Housekeeping, safe to run on a schedule. */
  deleteExpired(): Promise<number>;
}
