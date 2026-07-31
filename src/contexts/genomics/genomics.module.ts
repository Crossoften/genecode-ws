import { Module } from '@nestjs/common';

import { IdentityModule } from '@contexts/identity/identity.module';

import { ComputeReportUseCase } from './application/use-cases/compute-report.use-case';
import { GetReportUseCase } from './application/use-cases/get-report.use-case';
import { IngestGenotypesUseCase } from './application/use-cases/ingest-genotypes.use-case';
import { PANEL_REPOSITORY } from './domain/ports/panel.repository';
import { PrismaPanelRepository } from './infrastructure/repositories/prisma-panel.repository';
import { ReportsController } from './presentation/controllers/reports.controller';

/**
 * Genomics bounded context: markers, panels, the scoring engine and reports.
 *
 * The scoring domain itself lives under `domain/scoring/` and imports nothing
 * from Nest or Prisma — it is plain TypeScript, which is what lets the
 * contraprova run the 80 real patients in about a second without a database.
 */
@Module({
  imports: [IdentityModule],
  controllers: [ReportsController],
  providers: [
    ComputeReportUseCase,
    GetReportUseCase,
    IngestGenotypesUseCase,
    { provide: PANEL_REPOSITORY, useClass: PrismaPanelRepository },
  ],
  exports: [PANEL_REPOSITORY, ComputeReportUseCase, GetReportUseCase],
})
export class GenomicsModule {}
