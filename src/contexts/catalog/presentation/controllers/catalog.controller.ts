import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { IsPublic } from '@contexts/identity/presentation/decorators';
import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';

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
    private readonly prisma: PrismaService,
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

  /**
   * Valida um cupom de parceiro para o checkout mostrar o desconto ANTES da
   * compra (defeito mapeado D2: "a pessoa não vê o que economizou antes de
   * pagar"). Throttle apertado + resposta uniforme: a rota é pública e não
   * pode virar enumerador de cupons.
   */
  @Get('cupons/:code')
  @IsPublic()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Valida um cupom e devolve o desconto' })
  async coupon(@Param('code') code: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (!coupon || !coupon.active) throw new NotFoundError('Cupom inválido.');
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      throw new NotFoundError('Cupom inválido.');
    }
    return { code: coupon.code, discountPercent: Number(coupon.discountPercent) };
  }
}
