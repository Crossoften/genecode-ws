/**
 * Explicit success/failure type for use-case return values.
 *
 * Domain code throws only for programmer errors. Expected failures — invalid
 * credentials, expired token, sample code that does not exist — are values, not
 * exceptions. This keeps the happy path readable and, more importantly, makes
 * every failure the compiler's problem: you cannot read `.value` without first
 * narrowing on `isOk`.
 *
 * The HTTP layer is what turns a `Failure` into a status code, so the domain
 * never imports anything from Nest or Express.
 */
import type { DomainError } from './domain-error';

export type Result<T, E = DomainError> = Success<T, E> | Failure<T, E>;

export class Success<T, E> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  /** Narrows this result to `Success`, making `value` accessible. */
  isOk(): this is Success<T, E> {
    return true;
  }

  /** Narrows this result to `Failure`, making `error` accessible. */
  isFail(): this is Failure<T, E> {
    return false;
  }

  get value(): T {
    return this.#value;
  }
}

export class Failure<T, E> {
  readonly #error: E;

  constructor(error: E) {
    this.#error = error;
  }

  isOk(): this is Success<T, E> {
    return false;
  }

  isFail(): this is Failure<T, E> {
    return true;
  }

  get error(): E {
    return this.#error;
  }
}

/** Wraps a value as a successful result. */
export const ok = <T, E = DomainError>(value: T): Result<T, E> => new Success<T, E>(value);

/** Wraps an error as a failed result. */
export const fail = <T, E = DomainError>(error: E): Result<T, E> => new Failure<T, E>(error);

/** Convenience for use cases whose success carries no payload. */
export const okVoid = <E = DomainError>(): Result<void, E> => new Success<void, E>(undefined);
