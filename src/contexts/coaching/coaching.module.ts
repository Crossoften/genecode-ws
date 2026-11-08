import { Module } from '@nestjs/common';

import { GenomicsModule } from '@contexts/genomics/genomics.module';
import { IdentityModule } from '@contexts/identity/identity.module';

import { AdminTrainerDetailUseCase } from './application/use-cases/admin-trainer-detail.use-case';
import { AnswerAssessmentUseCase } from './application/use-cases/answer-assessment.use-case';
import { ConsolidatedReportUseCase } from './application/use-cases/consolidated-report.use-case';
import { ListAdminTrainersUseCase } from './application/use-cases/list-admin-trainers.use-case';
import { ManageQuestionnaireUseCase } from './application/use-cases/manage-questionnaire.use-case';
import { ManageSharingUseCase } from './application/use-cases/manage-sharing.use-case';
import { SharedReportUseCase } from './application/use-cases/shared-report.use-case';
import { AdminTrainersController } from './presentation/controllers/admin-trainers.controller';
import { CoachingController } from './presentation/controllers/coaching.controller';
import { QuestionnaireController } from './presentation/controllers/questionnaire.controller';

/** Contexto de acompanhamento profissional: compartilhamento, entrevista, score ajustado. */
@Module({
  // Genomics entra pelo GetReportUseCase: o laudo espelho do treinador
  // (GC-N05-15) é o laudo do titular, não uma cópia montada aqui.
  imports: [IdentityModule, GenomicsModule],
  controllers: [CoachingController, QuestionnaireController, AdminTrainersController],
  providers: [
    ManageSharingUseCase,
    SharedReportUseCase,
    ConsolidatedReportUseCase,
    AnswerAssessmentUseCase,
    ManageQuestionnaireUseCase,
    ListAdminTrainersUseCase,
    AdminTrainerDetailUseCase,
  ],
  exports: [ConsolidatedReportUseCase],
})
export class CoachingModule {}
