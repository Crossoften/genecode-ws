import { Module } from '@nestjs/common';

import { AnalyticsModule } from '@contexts/analytics/analytics.module';
import { IdentityModule } from '@contexts/identity/identity.module';

import { ComputeReportUseCase } from './application/use-cases/compute-report.use-case';
import { GetReportUseCase } from './application/use-cases/get-report.use-case';
import { LiberarLaudoUseCase } from './application/use-cases/liberar-laudo.use-case';
import { IngestGenotypesUseCase } from './application/use-cases/ingest-genotypes.use-case';
import { LabHistoryUseCase } from './application/use-cases/lab-history.use-case';
import { LabSamplesUseCase } from './application/use-cases/lab-samples.use-case';
import { PatientAreaUseCase } from './application/use-cases/patient-area.use-case';
import { NARRATIVE_PROVIDER } from './domain/ports/narrative.provider';
import { ORDER_PROGRESS } from './domain/ports/order-progress.port';
import { PANEL_REPOSITORY } from './domain/ports/panel.repository';
import { PrismaOrderProgressGateway } from './infrastructure/gateways/prisma-order-progress.gateway';
import { MatrixNarrativeProvider } from './infrastructure/narrative/matrix-narrative.provider';
import { TableNarrativeProvider } from './infrastructure/narrative/table-narrative.provider';
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
  imports: [IdentityModule, AnalyticsModule],
  controllers: [ReportsController],
  providers: [
    LiberarLaudoUseCase,
    ComputeReportUseCase,
    GetReportUseCase,
    IngestGenotypesUseCase,
    LabHistoryUseCase,
    LabSamplesUseCase,
    PatientAreaUseCase,
    { provide: PANEL_REPOSITORY, useClass: PrismaPanelRepository },
    { provide: ORDER_PROGRESS, useClass: PrismaOrderProgressGateway },

    // A matriz do cliente é o gerador (GC-AJ-018); a IA foi descartada em
    // 20/10. A tabela fica para o painel que não tem matriz — a Nutrigenética.
    TableNarrativeProvider,
    MatrixNarrativeProvider,
    { provide: NARRATIVE_PROVIDER, useExisting: MatrixNarrativeProvider },
  ],
  exports: [PANEL_REPOSITORY, NARRATIVE_PROVIDER, ComputeReportUseCase, GetReportUseCase],
})
export class GenomicsModule {}
