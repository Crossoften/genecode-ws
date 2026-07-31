import { Module } from '@nestjs/common';

import { IdentityModule } from '@contexts/identity/identity.module';

import { BusinessIntelligenceUseCase } from './application/use-cases/business-intelligence.use-case';
import { AdminController } from './presentation/controllers/admin.controller';

/**
 * Contexto de analytics: painel administrativo e BI.
 *
 * Escopo deliberadamente limitado. Rafael alertou em 15/06 que BI "pode se
 * tornar um segundo projeto", e o acordo com o cliente foi entregar os cinco
 * principais indicadores de cada área — não um motor genérico de relatórios.
 */
@Module({
  imports: [IdentityModule],
  controllers: [AdminController],
  providers: [BusinessIntelligenceUseCase],
})
export class AnalyticsModule {}
