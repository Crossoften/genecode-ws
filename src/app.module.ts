import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { CatalogModule } from '@contexts/catalog/catalog.module';
import { CoachingModule } from '@contexts/coaching/coaching.module';
import { GenomicsModule } from '@contexts/genomics/genomics.module';
import { LabModule } from '@contexts/lab/lab.module';
import { OrderingModule } from '@contexts/ordering/ordering.module';
import { IdentityModule } from '@contexts/identity/identity.module';
import { JwtAuthGuard } from '@contexts/identity/presentation/guards/jwt-auth.guard';
import { AuthorizationGuard } from '@contexts/identity/presentation/guards/authorization.guard';
import { PrismaModule } from '@infra/database/prisma.module';
import { DomainExceptionFilter } from '@infra/http/filters/domain-exception.filter';
import { validateEnv } from '@shared/config/env.schema';

import { HealthController } from './health.controller';

/**
 * Application root.
 *
 * The guard order below is the security posture of the whole API, so it is worth
 * being explicit about it. Nest runs `APP_GUARD` providers in declaration order:
 *
 *   1. `ThrottlerGuard`    — rate limit before doing any work
 *   2. `JwtAuthGuard`      — authenticate; every route is protected unless it
 *                            carries `@IsPublic()`
 *   3. `AuthorizationGuard` — check roles and permissions
 *
 * Secure by default is the point: forgetting a decorator locks an endpoint down
 * rather than exposing it. The previous backend had the same global guard but
 * opted out so liberally that a public route ended up returning every user's
 * password reset code.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Boot fails loudly on a bad or incomplete environment.
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    PrismaModule,
    IdentityModule,
    GenomicsModule,
    CatalogModule,
    OrderingModule,
    LabModule,
    CoachingModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
