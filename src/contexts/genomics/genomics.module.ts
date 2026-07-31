import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IdentityModule } from '@contexts/identity/identity.module';

import { ComputeReportUseCase } from './application/use-cases/compute-report.use-case';
import { GetReportUseCase } from './application/use-cases/get-report.use-case';
import { IngestGenotypesUseCase } from './application/use-cases/ingest-genotypes.use-case';
import { NARRATIVE_PROVIDER } from './domain/ports/narrative.provider';
import { PANEL_REPOSITORY } from './domain/ports/panel.repository';
import { AiNarrativeProvider } from './infrastructure/narrative/ai-narrative.provider';
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
  imports: [IdentityModule],
  controllers: [ReportsController],
  providers: [
    ComputeReportUseCase,
    GetReportUseCase,
    IngestGenotypesUseCase,
    { provide: PANEL_REPOSITORY, useClass: PrismaPanelRepository },

    // Ambos são instanciáveis, porque a IA cai para a tabela quando o guardrail
    // recusa a saída. Qual deles atende a porta é decisão de configuração — é
    // isso que "agnóstica de modelo, trocável sem reescrita" quer dizer.
    TableNarrativeProvider,
    AiNarrativeProvider,
    {
      provide: NARRATIVE_PROVIDER,
      inject: [ConfigService, TableNarrativeProvider, AiNarrativeProvider],
      useFactory: (
        config: ConfigService,
        table: TableNarrativeProvider,
        ai: AiNarrativeProvider,
      ) => (config.get<string>('AI_NARRATIVE_PROVIDER') === 'ai' ? ai : table),
    },
  ],
  exports: [PANEL_REPOSITORY, NARRATIVE_PROVIDER, ComputeReportUseCase, GetReportUseCase],
})
export class GenomicsModule {}
