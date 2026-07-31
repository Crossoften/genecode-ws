import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { PERMISSIONS_KEY, ROLES_KEY } from '../decorators';
import type { AuthenticatedPrincipal } from './jwt-auth.guard';

/**
 * Enforces `@RequireRoles` and `@RequirePermissions`.
 *
 * Runs after {@link JwtAuthGuard}, so the principal is already on the request
 * with roles and permissions read fresh from the database.
 *
 * Semantics differ between the two on purpose: roles are alternatives (any of),
 * permissions are cumulative (all of). Asking for `orders.read` and
 * `orders.write` means the caller needs both.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const needsRoles = requiredRoles?.length ?? 0;
    const needsPermissions = requiredPermissions?.length ?? 0;
    if (needsRoles === 0 && needsPermissions === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedPrincipal }>();
    const principal = request.user;

    // Unreachable through the normal guard chain, but a route marked @IsPublic
    // together with @RequireRoles would land here. Fail closed.
    if (!principal) throw new ForbiddenException('Acesso negado.');

    if (needsRoles > 0) {
      const hasAnyRole = requiredRoles.some((role) => principal.roles.includes(role));
      if (!hasAnyRole) throw new ForbiddenException('Acesso negado.');
    }

    if (needsPermissions > 0) {
      const hasAll = requiredPermissions.every((perm) => principal.permissions.includes(perm));
      if (!hasAll) throw new ForbiddenException('Acesso negado.');
    }

    return true;
  }
}
