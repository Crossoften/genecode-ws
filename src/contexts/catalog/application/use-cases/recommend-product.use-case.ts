import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

import { QUIZ_TRAITS, scoreAnswers, type QuizTrait } from '../../domain/quiz';
import { ListProductsUseCase, type ProductView } from './list-products.use-case';

export interface RecommendationResult {
  readonly product: ProductView;
  /** Aderência do produto recomendado, de 0 a 100. */
  readonly affinity: number;
  /** Segunda melhor opção, para o cliente comparar. */
  readonly runnerUp: ProductView | null;
}

/**
 * Recomenda um produto a partir das respostas do quiz.
 *
 * A regra inegociável: **sempre há uma recomendação**. Augusto foi explícito em
 * 15/06 de que o quiz não pode dizer que nenhum produto serve. Aqui isso não
 * depende de disciplina de quem escreve o código — é consequência de somar
 * pontos e pegar o máximo.
 *
 * O empate cai no produto de menor `position`, que é a ordem que o admin definiu
 * na vitrine. Determinístico, e o cliente controla o desempate sem tocar em código.
 */
@Injectable()
export class RecommendProductUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listProducts: ListProductsUseCase,
  ) {}

  /**
   * @param answers - Mapa `questionId → optionId` com o que o visitante marcou.
   * @returns O produto recomendado, sua aderência e o segundo colocado.
   */
  async execute(answers: ReadonlyMap<string, string>): Promise<RecommendationResult | null> {
    const products = await this.listProducts.execute();
    if (products.length === 0) return null;

    const traitsByProduct = await this.loadTraits();
    const scores = scoreAnswers(answers);

    const ranked = products
      .map((product) => ({
        product,
        score: affinityFor(traitsByProduct.get(product.slug) ?? {}, scores),
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0]!;
    const maxPossible = Math.max(...ranked.map((entry) => entry.score), 1);

    return {
      product: best.product,
      affinity: Math.round((best.score / maxPossible) * 100),
      runnerUp: ranked[1]?.product ?? null,
    };
  }

  private async loadTraits(): Promise<Map<string, Partial<Record<QuizTrait, number>>>> {
    const rows = await this.prisma.productTrait.findMany({
      include: { product: { select: { slug: true } } },
    });

    const byProduct = new Map<string, Partial<Record<QuizTrait, number>>>();
    for (const row of rows) {
      const current = byProduct.get(row.product.slug) ?? {};
      current[row.trait as QuizTrait] = row.weight;
      byProduct.set(row.product.slug, current);
    }
    return byProduct;
  }
}

/**
 * Similaridade de cosseno entre o perfil do visitante e o do produto.
 *
 * Cosseno, e não produto escalar, por um motivo concreto: um produto
 * "generalista" tem peso alto em todos os eixos, e com produto escalar ele vence
 * quase sempre — só perde para alguém extremamente unilateral.
 *
 * Medi isso: com produto escalar, o Premium (85/85/100) era recomendado em 32 das
 * 36 combinações possíveis do quiz. Um quiz que indica o produto mais caro em 89%
 * dos casos não está recomendando, está empurrando — e o cliente pediu o quiz
 * justamente para ajudar quem não sabe qual kit comprar.
 *
 * O cosseno compara a **direção** dos dois perfis, ignorando magnitude. Quem
 * responde tudo voltado a nutrição recebe Nutrigenética; quem dá respostas
 * equilibradas recebe Premium, que é quando ele realmente é a melhor escolha.
 */
function affinityFor(
  productTraits: Partial<Record<QuizTrait, number>>,
  answerScores: Record<QuizTrait, number>,
): number {
  let dot = 0;
  let productMagnitude = 0;
  let answerMagnitude = 0;

  for (const trait of QUIZ_TRAITS) {
    const product = productTraits[trait] ?? 0;
    const answer = answerScores[trait];
    dot += product * answer;
    productMagnitude += product * product;
    answerMagnitude += answer * answer;
  }

  const denominator = Math.sqrt(productMagnitude) * Math.sqrt(answerMagnitude);
  return denominator === 0 ? 0 : dot / denominator;
}
