import { Module } from '@nestjs/common';

import { IdentityModule } from '@contexts/identity/identity.module';

import { ListAdminPartnersUseCase } from './application/use-cases/list-admin-partners.use-case';
import { PartnerDashboardUseCase } from './application/use-cases/partner-dashboard.use-case';
import { SetPartnerActiveUseCase } from './application/use-cases/set-partner-active.use-case';
import { AdminPartnersController } from './presentation/controllers/admin-partners.controller';
import { PartnerController } from './presentation/controllers/partner.controller';

/** Contexto de parceria: afiliados, cupons e repasses. */
@Module({
  imports: [IdentityModule],
  controllers: [PartnerController, AdminPartnersController],
  providers: [PartnerDashboardUseCase, ListAdminPartnersUseCase, SetPartnerActiveUseCase],
})
export class PartnershipModule {}
