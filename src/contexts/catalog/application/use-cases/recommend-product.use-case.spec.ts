import { QUIZ_OPTIONS, QUIZ_STATEMENTS, type QuizBlock } from '../../domain/quiz';
import type { ListProductsUseCase, ProductView } from './list-products.use-case';
import { RecommendProductUseCase } from './recommend-product.use-case';

function product(slug: string): ProductView {
  return {
    slug,
    name: `gene.code ${slug}`,
    summary: '',
    description: '',
    markerCount: 30,
    priceCents: 65_000,
    promoPriceCents: null,
    maxInstallments: 5,
    highlight: null,
    imageUrl: null,
    features: [],
  };
}

/** Ordem da vitrine no seed: nutrigenética, performance, completo. */
const CATALOG = [product('nutrigenetica'), product('performance'), product('premium')];

function answersScoring(totals: Record<QuizBlock, number>): ReadonlyMap<string, string> {
  const remaining = { ...totals };
  const answers = new Map<string, string>();

  for (const statement of QUIZ_STATEMENTS) {
    const points = Math.min(2, Math.max(0, remaining[statement.block]));
    remaining[statement.block] -= points;
    answers.set(statement.id, QUIZ_OPTIONS[points]!.id);
  }

  return answers;
}

function useCase(products: ProductView[]): RecommendProductUseCase {
  const listProducts = { execute: jest.fn(async () => products) };
  return new RecommendProductUseCase(listProducts as unknown as ListProductsUseCase);
}

describe('RecommendProductUseCase — quadrantes', () => {
  it('performance acima do corte devolve o painel de performance', async () => {
    const result = await useCase(CATALOG).execute(
      answersScoring({ performance: 10, nutrigenetica: 2 }),
    );

    expect(result?.product.slug).toBe('performance');
    expect(result?.blocos).toEqual({ performance: 10, nutrigenetica: 2 });
    expect(result?.orientacao).toBe('direta');
  });

  it('nutrigenética acima do corte devolve o painel de nutrigenética', async () => {
    const result = await useCase(CATALOG).execute(
      answersScoring({ performance: 3, nutrigenetica: 11 }),
    );

    expect(result?.product.slug).toBe('nutrigenetica');
    expect(result?.orientacao).toBe('direta');
  });

  it('os dois acima do corte devolvem o painel completo, com o bloco maior de segundo', async () => {
    const result = await useCase(CATALOG).execute(
      answersScoring({ performance: 8, nutrigenetica: 12 }),
    );

    expect(result?.product.slug).toBe('premium');
    expect(result?.runnerUp?.slug).toBe('nutrigenetica');
    expect(result?.affinity).toBe(83);
  });
});

/**
 * A regra de 15/06 — *"sempre vai ter que direcionar para algum"* — junto com a
 * terceira via aprovada em 09/09: no quadrante indefinido sai produto **e** sai
 * a orientação de procurar o treinador.
 */
describe('RecommendProductUseCase — nunca devolve produto nulo', () => {
  it('no quadrante indefinido recomenda o bloco maior e marca a orientação', async () => {
    const result = await useCase(CATALOG).execute(
      answersScoring({ performance: 2, nutrigenetica: 5 }),
    );

    expect(result?.product.slug).toBe('nutrigenetica');
    expect(result?.orientacao).toBe('consulte-treinador');
  });

  it('tudo em "Não" ainda recomenda: empate cai no painel completo', async () => {
    const result = await useCase(CATALOG).execute(
      answersScoring({ performance: 0, nutrigenetica: 0 }),
    );

    expect(result?.product.slug).toBe('premium');
    expect(result?.orientacao).toBe('consulte-treinador');
  });

  it('painel do quadrante despublicado cai para o publicado que cobre mais pontos', async () => {
    const result = await useCase([product('nutrigenetica'), product('premium')]).execute(
      answersScoring({ performance: 12, nutrigenetica: 1 }),
    );

    expect(result?.product.slug).toBe('premium');
    expect(result?.orientacao).toBe('direta');
  });

  it('sem nenhum dos três painéis publicados sobra o primeiro da vitrine', async () => {
    const result = await useCase([product('brinde')]).execute(
      answersScoring({ performance: 9, nutrigenetica: 9 }),
    );

    expect(result?.product.slug).toBe('brinde');
    expect(result?.runnerUp).toBeNull();
  });

  it('vitrine vazia é o único caso sem resposta — é falha de operação, não do quiz', async () => {
    const result = await useCase([]).execute(answersScoring({ performance: 9, nutrigenetica: 9 }));

    expect(result).toBeNull();
  });
});
