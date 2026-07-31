import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { IsPublic } from '@contexts/identity/presentation/decorators';
import { PrismaService } from '@infra/database/prisma.service';

interface HealthReport {
  status: 'ok' | 'degraded';
  uptime: number;
  checks: { database: 'up' | 'down' };
}

@ApiTags('Infraestrutura')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness and readiness probe.
   *
   * Actually queries the database and answers 503 when it is unreachable. The
   * previous backend returned a fixed string, so it reported healthy while the
   * database was down — which makes the probe worse than having none, since an
   * orchestrator would keep routing traffic to a broken instance.
   */
  @Get()
  @IsPublic()
  @ApiOperation({ summary: 'Estado da API e das dependências' })
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthReport> {
    const databaseUp = await this.prisma.isHealthy();

    response.status(databaseUp ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: databaseUp ? 'ok' : 'degraded',
      uptime: Math.floor(process.uptime()),
      checks: { database: databaseUp ? 'up' : 'down' },
    };
  }
}
