import { Module } from '@nestjs/common';

import { IdentityModule } from '@contexts/identity/identity.module';

import { AdminTrainerDetailUseCase } from './application/use-cases/admin-trainer-detail.use-case';
import { AnswerAssessmentUseCase } from './application/use-cases/answer-assessment.use-case';
import { ConsolidatedReportUseCase } from './application/use-cases/consolidated-report.use-case';
import { ListAdminTrainersUseCase } from './application/use-cases/list-admin-trainers.use-case';
import { ManageQuestionnaireUseCase } from './application/use-cases/manage-questionnaire.use-case';
import { ManageSharingUseCase } from './application/use-cases/manage-sharing.use-case';
import { AdminTrainersController } from './presentation/controllers/admin-trainers.controller';
import { CoachingController } from './presentation/controllers/coaching.controller';
import { QuestionnaireController } from './presentation/controllers/questionnaire.controller';

/** Contexto de acompanhamento profissional: compartilhamento, entrevista, score ajustado. */
@Module({
  imports: [IdentityModule],
  controllers: [CoachingController, QuestionnaireController, AdminTrainersController],
  providers: [
    ManageSharingUseCase,
    ConsolidatedReportUseCase,
    AnswerAssessmentUseCase,
    ManageQuestionnaireUseCase,
    ListAdminTrainersUseCase,
    AdminTrainerDetailUseCase,
  ],
  exports: [ConsolidatedReportUseCase],
})
export class CoachingModule {}
