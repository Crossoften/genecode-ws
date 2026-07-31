import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { DomainError, DomainErrorKind } from '@shared/domain/domain-error';

/** Maps domain failure kinds to HTTP status codes. */
const STATUS_BY_KIND: Record<DomainErrorKind, HttpStatus> = {
  [DomainErrorKind.VALIDATION]: HttpStatus.BAD_REQUEST,
  [DomainErrorKind.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [DomainErrorKind.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [DomainErrorKind.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [DomainErrorKind.CONFLICT]: HttpStatus.CONFLICT,
  [DomainErrorKind.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  [DomainErrorKind.UPSTREAM]: HttpStatus.BAD_GATEWAY,
};

interface ErrorBody {
  code: string;
  message: string;
  details?: Readonly<Record<string, unknown>>;
  path: string;
  timestamp: string;
}

/**
 * Single exit point for errors.
 *
 * Gives every failure the same envelope, so the frontend has one shape to handle
 * and can key its translated copy off the stable `code`.
 *
 * Unexpected exceptions are logged in full but answered with a generic message —
 * a stack trace or an ORM error string reaching the browser is an information
 * leak, and in a health product it may expose patient data.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.resolve(exception, request);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private resolve(exception: unknown, request: Request): { status: number; body: ErrorBody } {
    const base = { path: request.url, timestamp: new Date().toISOString() };

    if (exception instanceof DomainError) {
      return {
        status: STATUS_BY_KIND[exception.kind],
        body: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          ...base,
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ?? exception.message);

      return {
        status,
        body: {
          code: this.codeFromStatus(status),
          message: Array.isArray(message) ? message.join('; ') : message,
          // class-validator returns the per-field breakdown here; forward it so
          // the form can highlight the right inputs.
          details: typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined,
          ...base,
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno. Tente novamente em instantes.',
        ...base,
      },
    };
  }

  private codeFromStatus(status: number): string {
    return HttpStatus[status] ?? 'HTTP_ERROR';
  }
}
