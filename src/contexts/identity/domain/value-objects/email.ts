import { ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

/**
 * A validated, normalised email address.
 *
 * Exists so that an unvalidated string can never reach a repository. Once you
 * hold an `Email`, the value is known to be well-formed and lower-cased — which
 * matters because MySQL's default collation is case-insensitive but our
 * application logic should not depend on that.
 */
export class Email {
  // Deliberately permissive. Strict RFC 5322 regexes reject addresses that work
  // in practice; real verification is the confirmation code we send anyway.
  private static readonly PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  private static readonly MAX_LENGTH = 255;

  private constructor(readonly value: string) {}

  /**
   * Creates an `Email`, trimming and lower-casing the input.
   *
   * @param raw - Address as typed by the user.
   * @returns The value object, or a validation failure.
   */
  static create(raw: string): Result<Email> {
    const normalised = raw.trim().toLowerCase();

    if (normalised.length === 0) {
      return fail(new ValidationError('E-mail é obrigatório.', { field: 'email' }));
    }

    if (normalised.length > Email.MAX_LENGTH) {
      return fail(new ValidationError('E-mail excede o tamanho máximo.', { field: 'email' }));
    }

    if (!Email.PATTERN.test(normalised)) {
      return fail(new ValidationError('E-mail inválido.', { field: 'email' }));
    }

    return ok(new Email(normalised));
  }

  toString(): string {
    return this.value;
  }
}
