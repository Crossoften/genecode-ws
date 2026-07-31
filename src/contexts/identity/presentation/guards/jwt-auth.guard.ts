import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import type { Env } from '@shared/config/env.schema';

import type { AccessTokenClaims } from '../../application/services/token-issuer.service';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';
import { IS_PUBLIC_KEY } from '../decorators';

/** The caller, as resolved for the current request. */
export interface AuthenticatedPrincipal {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

/**
 * Global authentication guard.
 *
 * Verifies the access token, then loads the user from the database to build the
 * principal. Reading roles and permissions fresh — rather than trusting claims
 * baked into the token — is what makes revocation immediate: deactivate an
 * account or drop a permission and the very next request reflects it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);
    if (!token) throw new UnauthorizedException('Autenticação necessária.');

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    const user = await this.users.findById(claims.sub);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    const principal: AuthenticatedPrincipal = {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      permissions: user.permissions,
    };

    Object.assign(request, { user: principal });
    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
