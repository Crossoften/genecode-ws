import { Module } from '@nestjs/common';

import { IdentityModule } from '@contexts/identity/identity.module';

import { PartnerDashboardUseCase } from './application/use-cases/partner-dashboard.use-case';
import { PartnerController } from './presentation/controllers/partner.controller';

/** Contexto de parceria: afiliados, cupons e repasses. */
@Module({
  imports: [IdentityModule],
  controllers: [PartnerController],
  providers: [PartnerDashboardUseCase],
})
export class PartnershipModule {}
