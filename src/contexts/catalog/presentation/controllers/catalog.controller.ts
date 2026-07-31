import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { IsPublic } from '@contexts/identity/presentation/decorators';

import { ListProductsUseCase } from '../../application/use-cases/list-products.use-case';
import { RecommendProductUseCase } from '../../application/use-cases/recommend-product.use-case';
import { QUIZ } from '../../domain/quiz';
import { QuizAnswersDto } from '../dtos/quiz.dto';

@ApiTags('Vitrine')
@Controller('vitrine')
export class CatalogController {
  constructor(
    private readonly listProducts: ListProductsUseCase,
    private readonly recommend: RecommendProductUseCase,
  ) {}

  /** Produtos da vitrine. Público: é a porta de entrada do funil. */
  @Get('produtos')
  @IsPublic()
  @ApiOperation({ summary: 'Lista os produtos publicados na vitrine' })
  async products() {
    return this.listProducts.execute();
  }

  /** Perguntas do quiz de recomendação. */
  @Get('quiz')
  @IsPublic()
  @ApiOperation({ summary: 'Perguntas do quiz de recomendação' })
  quiz() {
    return { questions: QUIZ };
  }

  /**
   * Recomenda um produto a partir das respostas.
   *
   * Sempre devolve uma recomendação enquanto houver produto publicado — foi
   * requisito explícito do cliente em 15/06.
   */
  @Post('quiz')
  @IsPublic()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recomenda um produto a partir das respostas do quiz' })
  async recommendation(@Body() dto: QuizAnswersDto) {
    const answers = new Map(dto.answers.map((answer) => [answer.questionId, answer.optionId]));
    return this.recommend.execute(answers);
  }
}
