/**
 * Base class for expected, business-meaningful failures.
 *
 * Domain errors carry a stable machine-readable `code` alongside the message.
 * The frontend keys its translated copy off `code`, so rewording a message never
 * breaks the UI, and the API can be consumed by clients that speak other
 * languages later.
 *
 * `kind` is what the HTTP layer maps to a status code — the domain itself has no
 * notion of 404 or 409.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly kind: DomainErrorKind;

  /** Extra context for logs and for the client. Never include secrets here. */
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export enum DomainErrorKind {
  /** Input failed a business rule. → 400 */
  VALIDATION = 'VALIDATION',
  /** Caller is not authenticated. → 401 */
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  /** Caller is authenticated but lacks permission. → 403 */
  FORBIDDEN = 'FORBIDDEN',
  /** Referenced entity does not exist. → 404 */
  NOT_FOUND = 'NOT_FOUND',
  /** Operation conflicts with current state. → 409 */
  CONFLICT = 'CONFLICT',
  /** Too many attempts. → 429 */
  RATE_LIMITED = 'RATE_LIMITED',
  /** An external dependency failed. → 502 */
  UPSTREAM = 'UPSTREAM',
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
  readonly kind = DomainErrorKind.VALIDATION;
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  readonly kind = DomainErrorKind.UNAUTHENTICATED;
}

export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
  readonly kind = DomainErrorKind.FORBIDDEN;
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly kind = DomainErrorKind.NOT_FOUND;
}

export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';
  readonly kind = DomainErrorKind.CONFLICT;
}
