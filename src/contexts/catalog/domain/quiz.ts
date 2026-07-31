/**
 * Quiz de recomendação de produto.
 *
 * Três passos, como o cliente pediu em 15/06. A regra que governa tudo aqui foi
 * dita por Augusto na mesma reunião:
 *
 * > *"Sempre a gente vai ter que orientar para algum produto. Não pode assim,
 * > 'ah, para você não serve nenhum', sempre vai ter que direcionar para algum."*
 *
 * Por isso a recomendação é por **pontuação em eixos**, não por árvore de regras:
 * somam-se os pesos de cada resposta nos três eixos, e vence o produto com maior
 * aderência. Sempre existe um vencedor — resultado nulo é impossível por
 * construção, não por um `else` no fim de uma cadeia de ifs.
 */
export const QUIZ_TRAITS = ['nutrition', 'performance', 'health'] as const;

export type QuizTrait = (typeof QUIZ_TRAITS)[number];

/** Peso que uma opção adiciona a cada eixo. */
export type TraitWeights = Partial<Record<QuizTrait, number>>;

export interface QuizOption {
  readonly id: string;
  readonly label: string;
  readonly weights: TraitWeights;
}

export interface QuizQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly QuizOption[];
}

/**
 * As três perguntas.
 *
 * A segunda — frequência de treino — pesa menos de propósito. No protótipo ela
 * era coletada e simplesmente ignorada no cálculo; aqui ela influencia, mas sem
 * dominar, porque quem não treina hoje pode estar comprando justamente para
 * começar.
 */
export const QUIZ: readonly QuizQuestion[] = [
  {
    id: 'objetivo',
    prompt: 'Qual é o seu objetivo principal?',
    options: [
      {
        id: 'alimentacao',
        label: 'Melhorar a alimentação e o bem-estar',
        weights: { nutrition: 100, health: 30 },
      },
      {
        id: 'treino',
        label: 'Evoluir no treino e na performance',
        weights: { performance: 100, health: 20 },
      },
      {
        id: 'completa',
        label: 'Ter uma visão completa da minha saúde',
        weights: { health: 100, nutrition: 45, performance: 45 },
      },
    ],
  },
  {
    id: 'frequencia',
    prompt: 'Com que frequência você treina?',
    options: [
      { id: 'raramente', label: 'Raramente ou não treino', weights: { nutrition: 25 } },
      { id: 'moderado', label: '2 a 4 vezes por semana', weights: { performance: 20, health: 15 } },
      { id: 'intenso', label: 'Quase todos os dias', weights: { performance: 35 } },
      { id: 'atleta', label: 'Sou atleta ou competidor', weights: { performance: 45 } },
    ],
  },
  {
    id: 'interesse',
    prompt: 'O que mais te interessa no resultado?',
    options: [
      {
        id: 'dieta',
        label: 'Dieta, nutrientes e sensibilidades',
        weights: { nutrition: 80 },
      },
      {
        id: 'treino',
        label: 'Treino, força e recuperação',
        weights: { performance: 80 },
      },
      {
        id: 'prevencao',
        label: 'Prevenção, saúde e longevidade',
        weights: { health: 90 },
      },
    ],
  },
];

/**
 * Soma os pesos das respostas escolhidas.
 *
 * Respostas desconhecidas são ignoradas em silêncio — um cliente antigo com uma
 * versão velha do quiz não deve receber erro, deve receber a melhor
 * recomendação possível com o que respondeu.
 *
 * @param answers - Mapa `questionId → optionId`.
 * @returns Pontuação acumulada por eixo.
 */
export function scoreAnswers(answers: ReadonlyMap<string, string>): Record<QuizTrait, number> {
  const totals: Record<QuizTrait, number> = { nutrition: 0, performance: 0, health: 0 };

  for (const question of QUIZ) {
    const chosen = answers.get(question.id);
    if (!chosen) continue;

    const option = question.options.find((candidate) => candidate.id === chosen);
    if (!option) continue;

    for (const trait of QUIZ_TRAITS) {
      totals[trait] += option.weights[trait] ?? 0;
    }
  }

  return totals;
}
