import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma client bound to the Nest lifecycle.
 *
 * This is the only place in the codebase allowed to import `@prisma/client`
 * outside of a repository implementation. Use cases depend on repository
 * interfaces from `domain/ports`, never on this class — that is what keeps the
 * scoring engine testable without a running database.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  /**
   * Verifies the database is actually reachable.
   *
   * Used by the health endpoint. The previous backend's health check returned a
   * hardcoded string, so it reported healthy while the database was down.
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return false;
    }
  }
}
