import { Module } from '@nestjs/common';

import { IdentityModule } from '@contexts/identity/identity.module';

import { ConsolidatedReportUseCase } from './application/use-cases/consolidated-report.use-case';
import { ManageSharingUseCase } from './application/use-cases/manage-sharing.use-case';
import { CoachingController } from './presentation/controllers/coaching.controller';

/** Contexto de acompanhamento profissional: compartilhamento, entrevista, score ajustado. */
@Module({
  imports: [IdentityModule],
  controllers: [CoachingController],
  providers: [ManageSharingUseCase, ConsolidatedReportUseCase],
  exports: [ConsolidatedReportUseCase],
})
export class CoachingModule {}
