import { Module } from '@nestjs/common';

import { IdentityModule } from '@contexts/identity/identity.module';

import { ActivateKitUseCase } from './application/use-cases/activate-kit.use-case';
import { EmitirKitsUseCase } from './application/use-cases/emitir-kits.use-case';
import { KitController } from './presentation/controllers/kit.controller';

/** Contexto de laboratório: kits, códigos de ativação e amostras. */
@Module({
  imports: [IdentityModule],
  controllers: [KitController],
  providers: [ActivateKitUseCase, EmitirKitsUseCase],
  exports: [ActivateKitUseCase],
})
export class LabModule {}
