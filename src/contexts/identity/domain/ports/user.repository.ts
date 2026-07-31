import type { Email } from '../value-objects/email';

/** Injection token — the domain never names a concrete implementation. */
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

/** A user as the domain sees it, free of any Prisma type. */
export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly name: string;
  readonly status: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  readonly emailVerifiedAt: Date | null;
  readonly twoFactorEnabled: boolean;
  readonly deletedAt: Date | null;
  /** Permission slugs, flattened from the user's roles. */
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}

export interface CreateUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly name: string;
  readonly document?: string;
  readonly phone?: string;
}

/**
 * Persistence boundary for user accounts.
 *
 * Use cases depend on this interface, and the module binds it to the Prisma
 * implementation. Swapping the store, or faking it in a unit test, touches no
 * business logic.
 */
export interface UserRepository {
  /** Finds an active (non-deleted) user by email, or null. */
  findByEmail(email: Email): Promise<UserRecord | null>;

  /** Finds an active (non-deleted) user by id, or null. */
  findById(id: string): Promise<UserRecord | null>;

  /** True when the email is already taken by a non-deleted account. */
  existsByEmail(email: Email): Promise<boolean>;

  /** Persists a new account in `PENDING` status. */
  create(input: CreateUserInput): Promise<UserRecord>;

  /** Replaces the stored password hash. */
  updatePassword(userId: string, passwordHash: string): Promise<void>;

  /** Marks the email as verified and promotes the account to `ACTIVE`. */
  markEmailVerified(userId: string): Promise<void>;
}
