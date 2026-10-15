import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@contexts/identity/presentation/decorators';

import { AdminTrainerDetailUseCase } from '../../application/use-cases/admin-trainer-detail.use-case';
import { ListAdminTrainersUseCase } from '../../application/use-cases/list-admin-trainers.use-case';

/**
 * Gestão de treinadores (card #526).
 *
 * Tela do admin/master para ver os perfis de treinador, a situação da curadoria
 * de cada um, os alunos que autorizaram o acesso e as avaliações já feitas. Só
 * leitura — a moderação (aprovar/recusar à mão) é o passo seguinte, e por isso
 * o `status` já viaja nestas respostas.
 */
@ApiTags('Admin · Treinadores')
@Controller('admin/treinadores')
export class AdminTrainersController {
  constructor(
    private readonly listTrainers: ListAdminTrainersUseCase,
    private readonly trainerDetail: AdminTrainerDetailUseCase,
  ) {}

  @Get()
  @RequirePermissions('professionals.read')
  @ApiOperation({ summary: 'Lista os treinadores com KPIs de curadoria e uso' })
  async list() {
    return this.listTrainers.execute();
  }

  @Get(':id')
  @RequirePermissions('professionals.read')
  @ApiOperation({ summary: 'Detalhe de um treinador: perfil, alunos e avaliações' })
  async detail(@Param('id') id: string) {
    const result = await this.trainerDetail.execute(id);
    if (result.isFail()) throw result.error;
    return result.value;
  }
}
