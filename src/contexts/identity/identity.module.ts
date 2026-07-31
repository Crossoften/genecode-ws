import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { HashService } from '@shared/crypto/hash.service';

import { TokenIssuer } from './application/services/token-issuer.service';
import { AuthenticateUseCase } from './application/use-cases/authenticate.use-case';
import { REFRESH_TOKEN_REPOSITORY } from './domain/ports/refresh-token.repository';
import { USER_REPOSITORY } from './domain/ports/user.repository';
import { PrismaRefreshTokenRepository } from './infrastructure/repositories/prisma-refresh-token.repository';
import { PrismaUserRepository } from './infrastructure/repositories/prisma-user.repository';
import { AuthController } from './presentation/controllers/auth.controller';

/**
 * Identity bounded context: accounts, sessions, roles and permissions.
 *
 * This module is where the dependency inversion is actually wired. Use cases ask
 * for `USER_REPOSITORY`; only these two lines know that Prisma exists. Replacing
 * the persistence layer, or faking it in a test, changes nothing above.
 *
 * The repositories are exported because other contexts — the guard chain, and
 * later the consent and coaching contexts — need to resolve a user without
 * reaching into this context's internals.
 */
@Module({
  imports: [
    // Secrets are passed per-signature in TokenIssuer rather than registered
    // here, because access and refresh tokens use different keys.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    HashService,
    TokenIssuer,
    AuthenticateUseCase,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: PrismaRefreshTokenRepository },
  ],
  // JwtModule é reexportado porque os guards globais são registrados no
  // AppModule (para que a ordem de execução fique explícita num só lugar) e
  // precisam resolver o JwtService a partir de lá.
  exports: [JwtModule, USER_REPOSITORY, REFRESH_TOKEN_REPOSITORY, HashService, TokenIssuer],
})
export class IdentityModule {}
