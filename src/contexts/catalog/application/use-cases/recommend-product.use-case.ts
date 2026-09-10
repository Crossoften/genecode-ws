import { Injectable } from '@nestjs/common';

import {
  affinityFor,
  coverageBySlug,
  QUIZ_PRODUCT_SLUGS,
  resolveQuiz,
  type QuizBlockScores,
  type QuizGuidance,
  type QuizProductSlug,
} from '../../domain/quiz';
import { ListProductsUseCase, type ProductView } from './list-products.use-case';

/**
 * Resposta do quiz.
 *
 * Os nomes misturam inglês e português de propósito: `blocos` e `orientacao`
 * entraram em 09/09 com esses nomes exatos, combinados com o front, e renomear
 * agora só criaria um de/para inútil no meio do caminho.
 */
export interface RecommendationResult {
  readonly product: ProductView;
  /**
   * Aderência do produto recomendado, de 0 a 100 — agora é a fração dos pontos
   * que o painel cobre, não mais a similaridade de cosseno do motor antigo.
   */
  readonly affinity: number;
  /** Segunda melhor opção, para o cliente comparar. */
  readonly runnerUp: ProductView | null;
  /** Pontuação de cada bloco, de 0 a 12. É o que a tela de resultado exibe. */
  readonly blocos: QuizBlockScores;
  /** `consulte-treinador` manda a tela mostrar também a mensagem do treinador. */
  readonly orientacao: QuizGuidance;
}

/**
 * Recomenda um painel a partir das respostas do quiz.
 *
 * A regra inegociável de 15/06 continua valendo: **sempre há uma recomendação**.
 * Augusto foi explícito de que o quiz não pode dizer que nenhum produto serve, e
 * isso aqui não depende da disciplina de quem escreve o código — a regra de
 * quadrante do domínio sempre devolve um slug, e este caso de uso só tem um
 * caminho sem produto: catálogo vazio, que é falha de operação, não resultado do
 * quiz.
 *
 * O painel que o quadrante escolheu pode estar despublicado ou arquivado. Nesse
 * caso cai para o painel publicado que cobre mais pontos das respostas, e o
 * empate vai para o de menor `position` — a ordem que o admin definiu na vitrine,
 * que é onde o cliente controla o desempate sem tocar em código.
 */
@Injectable()
export class RecommendProductUseCase {
  constructor(private readonly listProducts: ListProductsUseCase) {}

  /**
   * @param answers - Mapa `statementId → optionId` com o que o visitante marcou.
   * @returns Recomendação, pontuação por bloco e orientação; `null` só com a
   *   vitrine sem nenhum produto publicado.
   */
  async execute(answers: ReadonlyMap<string, string>): Promise<RecommendationResult | null> {
    const products = await this.listProducts.execute();
    if (products.length === 0) return null;

    const outcome = resolveQuiz(answers);
    const published = new Map(products.map((product) => [product.slug, product]));
    const ranked = this.rankPanels(outcome.blocks, published);

    const chosen = published.has(outcome.productSlug) ? outcome.productSlug : ranked.at(0);
    const runnerUp = ranked.find((slug) => slug !== chosen);

    return {
      // Sem nenhum dos três painéis publicado sobra o primeiro da vitrine: pior
      // recomendação, mas ainda uma recomendação.
      product: (chosen ? published.get(chosen) : undefined) ?? products[0]!,
      affinity: affinityFor(chosen ?? outcome.productSlug, outcome.blocks),
      runnerUp: runnerUp ? (published.get(runnerUp) ?? null) : null,
      blocos: outcome.blocks,
      orientacao: outcome.guidance,
    };
  }

  private rankPanels(
    blocks: QuizBlockScores,
    published: ReadonlyMap<string, ProductView>,
  ): QuizProductSlug[] {
    const coverage = coverageBySlug(blocks);
    const positions = new Map([...published.keys()].map((slug, index) => [slug, index]));

    return QUIZ_PRODUCT_SLUGS.filter((slug) => published.has(slug)).sort(
      (a, b) => coverage[b] - coverage[a] || positions.get(a)! - positions.get(b)!,
    );
  }
}
