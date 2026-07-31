import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Database access, exposed globally so repository implementations can inject it
 * without every context module re-importing it.
 *
 * Global scope is acceptable here precisely because only repositories touch it —
 * controllers and use cases have no reason to, and code review should treat a
 * `PrismaService` in either as a defect.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
