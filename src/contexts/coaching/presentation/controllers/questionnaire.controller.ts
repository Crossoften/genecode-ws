import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@contexts/identity/presentation/decorators';

import { ManageQuestionnaireUseCase } from '../../application/use-cases/manage-questionnaire.use-case';
import { QuestionDto } from '../dtos/questionnaire.dto';

/**
 * Autoria do questionário ambiental — o laboratório repesa as perguntas pelo
 * admin, sem deploy (decisão B5). Guardado por `questionnaire.write`, que só
 * admin, master e lab carregam.
 */
@ApiTags('Questionário ambiental')
@Controller('admin/questionario')
export class QuestionnaireController {
  constructor(private readonly questions: ManageQuestionnaireUseCase) {}

  @Get()
  @RequirePermissions('questionnaire.read')
  @ApiOperation({ summary: 'Lista as perguntas, opcionalmente por painel' })
  async list(@Query('painel') panelSlug?: string) {
    return this.questions.list(panelSlug);
  }

  @Post()
  @RequirePermissions('questionnaire.write')
  @ApiOperation({ summary: 'Cria uma pergunta com suas opções' })
  async create(@Body() dto: QuestionDto) {
    const result = await this.questions.create(dto);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  @Put(':id')
  @RequirePermissions('questionnaire.write')
  @ApiOperation({ summary: 'Atualiza uma pergunta e substitui suas opções' })
  async update(@Param('id') id: string, @Body() dto: QuestionDto) {
    const result = await this.questions.update(id, dto);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  @Patch(':id/ativo')
  @RequirePermissions('questionnaire.write')
  @ApiOperation({ summary: 'Liga ou desliga uma pergunta' })
  async setActive(@Param('id') id: string, @Body() body: { active: boolean }) {
    const result = await this.questions.setActive(id, body.active);
    if (result.isFail()) throw result.error;
    return { id, active: body.active };
  }
}
