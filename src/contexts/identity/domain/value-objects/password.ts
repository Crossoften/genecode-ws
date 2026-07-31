import { ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

/**
 * A plaintext password that has passed the strength policy.
 *
 * The rules mirror the meter shown in the approved prototype's signup screen
 * ("8+ caracteres, 1 maiúscula, 1 número"), so the frontend indicator and the
 * backend never disagree about what counts as acceptable.
 *
 * Note there is no maximum beyond a DoS guard. The previous backend capped
 * passwords at 8 characters via `@MaxLength(8)`, which actively prevented users
 * from choosing strong ones.
 */
export class Password {
  private static readonly MIN_LENGTH = 8;
  /** Not a policy limit — just a bound so bcrypt is never handed a huge payload. */
  private static readonly MAX_LENGTH = 128;

  private constructor(readonly value: string) {}

  /**
   * Validates a plaintext password against the strength policy.
   *
   * @param raw - Password as typed by the user, never trimmed: leading and
   *   trailing spaces are legitimate characters.
   */
  static create(raw: string): Result<Password> {
    if (raw.length < Password.MIN_LENGTH) {
      return fail(
        new ValidationError('A senha deve ter no mínimo 8 caracteres.', { field: 'password' }),
      );
    }

    if (raw.length > Password.MAX_LENGTH) {
      return fail(
        new ValidationError('A senha excede o tamanho máximo permitido.', { field: 'password' }),
      );
    }

    if (!/[A-Z]/.test(raw)) {
      return fail(
        new ValidationError('A senha deve conter ao menos uma letra maiúscula.', {
          field: 'password',
        }),
      );
    }

    if (!/[0-9]/.test(raw)) {
      return fail(
        new ValidationError('A senha deve conter ao menos um número.', { field: 'password' }),
      );
    }

    return ok(new Password(raw));
  }

  /** Prevents the plaintext from leaking into logs or error dumps. */
  toString(): string {
    return '[REDACTED]';
  }

  toJSON(): string {
    return '[REDACTED]';
  }
}
