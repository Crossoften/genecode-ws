import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../guards/jwt-auth.guard';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';
export const ROLES_KEY = 'roles';

/**
 * Opts a route out of authentication.
 *
 * Authentication is global and on by default — a new endpoint is protected
 * unless someone deliberately writes this. The previous backend used the same
 * pattern but sprinkled the opt-out across the upload and user-listing routes,
 * which is how a public endpoint ended up returning password reset codes. Treat
 * every use of this decorator as something to justify in review.
 */
export const IsPublic = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires the caller to hold all of the given permission slugs.
 *
 * Declarative, unlike the old backend which called an imperative helper inside
 * each controller and injected Prisma into the presentation layer to do it.
 *
 * @param permissions - Slugs from the `permissions` table, e.g. `orders.read`.
 */
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Requires the caller to hold at least one of the given role slugs.
 *
 * @param roles - Slugs from the `roles` table, e.g. `admin`, `professional`.
 */
export const RequireRoles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Injects the authenticated principal into a handler parameter.
 *
 * Returns the full principal — id, email, roles and permissions — resolved from
 * the database on this request, not decoded from the token.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal => {
    const request = context.switchToHttp().getRequest<{ user: AuthenticatedPrincipal }>();
    return request.user;
  },
);
