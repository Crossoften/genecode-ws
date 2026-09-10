/**
 * Quiz de recomendação de produto.
 *
 * Motor reescrito sobre a redação nova do quiz (material do cliente, set/2026).
 * Saíram os três eixos com pesos por opção e a similaridade de cosseno; entraram
 * 12 afirmações em dois blocos de seis — performance esportiva e nutrigenética —
 * com as mesmas três opções para todas (Não=0, Um pouco=1, Sim=2) e soma simples
 * por bloco, de 0 a 12. O corte é 7: de 7 a 12 o bloco conta como interesse
 * declarado, de 0 a 6 não conta.
 *
 * A regra de 15/06, dita por Augusto, continua sendo o motivo de nada aqui poder
 * devolver vazio:
 *
 * > *"Sempre a gente vai ter que orientar para algum produto. Não pode assim,
 * > 'ah, para você não serve nenhum', sempre vai ter que direcionar para algum."*
 *
 * O documento novo colide de frente com isso num ponto: quando os dois blocos
 * ficam abaixo de 7, ele manda não recomendar nada e mandar procurar o treinador.
 * André decidiu em 09/09 pela terceira via — recomendar o painel do bloco de
 * maior pontuação **e** marcar a resposta com a orientação de consultar o
 * treinador. As duas coisas juntas, nunca uma no lugar da outra.
 */

/**
 * Os dois blocos de afirmações.
 *
 * Os ids coincidem de propósito com os slugs dos produtos correspondentes: o
 * bloco vencedor vira recomendação sem tabela de/para no meio.
 */
export const QUIZ_BLOCKS = ['performance', 'nutrigenetica'] as const;

export type QuizBlock = (typeof QUIZ_BLOCKS)[number];

export interface QuizOption {
  readonly id: string;
  readonly label: string;
  /** Pontos que a opção soma no bloco da afirmação. */
  readonly score: number;
}

/**
 * As três opções, idênticas para as 12 afirmações.
 *
 * Ficam num array único, e não repetidas dentro de cada afirmação, porque o
 * documento não abre exceção para nenhuma delas: duplicar só criaria a chance de
 * o texto ou a pontuação divergirem numa das doze.
 */
export const QUIZ_OPTIONS = [
  { id: 'nao', label: 'Não', score: 0 },
  { id: 'um-pouco', label: 'Um pouco', score: 1 },
  { id: 'sim', label: 'Sim', score: 2 },
] as const satisfies readonly QuizOption[];

export type QuizOptionId = (typeof QUIZ_OPTIONS)[number]['id'];

/** Conjunto fechado de opções aceitas, para o DTO validar sem repetir a lista. */
export const QUIZ_OPTION_IDS: readonly QuizOptionId[] = QUIZ_OPTIONS.map((option) => option.id);

export interface QuizStatement {
  readonly id: string;
  readonly block: QuizBlock;
  /**
   * Texto exato do documento do cliente. Reescrever aqui é reescrever material
   * aprovado — se a frase precisar mudar, muda antes lá.
   */
  readonly prompt: string;
  readonly options: readonly QuizOption[];
}

/**
 * As 12 afirmações, na ordem do documento: as seis de performance e depois as
 * seis de nutrigenética. A ordem importa porque a tela mostra uma afirmação por
 * vez (decisão 15, de 09/09) e o visitante avança em sequência.
 */
export const QUIZ_STATEMENTS: readonly QuizStatement[] = [
  {
    id: 'perf-1',
    block: 'performance',
    prompt: 'Você pratica exercícios físicos ou algum esporte regularmente?',
    options: QUIZ_OPTIONS,
  },
  {
    id: 'perf-2',
    block: 'performance',
    prompt:
      'Você gostaria de entender melhor sua predisposição para força, potência, velocidade ou resistência?',
    options: QUIZ_OPTIONS,
  },
  {
    id: 'perf-3',
    block: 'performance',
    prompt: 'Quer personalizar seus treinos de acordo com suas características genéticas?',
    options: QUIZ_OPTIONS,
  },
  {
    id: 'perf-4',
    block: 'performance',
    prompt:
      'Busca melhorar seu desempenho, seu condicionamento físico ou sua recuperação após os exercícios?',
    options: QUIZ_OPTIONS,
  },
  {
    id: 'perf-5',
    block: 'performance',
    prompt:
      'Tem interesse em conhecer características genéticas relacionadas a lesões musculares, tendíneas ou articulares?',
    options: QUIZ_OPTIONS,
  },
  {
    id: 'perf-6',
    block: 'performance',
    prompt:
      'Quer compreender fatores genéticos associados à fadiga, à inflamação e à resposta ao treinamento?',
    options: QUIZ_OPTIONS,
  },
  {
    id: 'nutri-1',
    block: 'nutrigenetica',
    prompt: 'Você tem dificuldade em controlar o peso ou em manter os resultados de uma dieta?',
    options: QUIZ_OPTIONS,
  },
  {
    id: 'nutri-2',
    block: 'nutrigenetica',
    prompt:
      'Você gostaria de entender como seu organismo responde a carboidratos, gorduras e proteínas?',
    options: QUIZ_OPTIONS,
  },
  {
    id: 'nutri-3',
    block: 'nutrigenetica',
    prompt:
      'Tem interesse em conhecer predisposições relacionadas à fome, à saciedade ou ao comportamento alimentar?',
    options: QUIZ_OPTIONS,
  },
  {
    id: 'nutri-4',
    block: 'nutrigenetica',
    prompt:
      'Quer saber se possui características genéticas relacionadas ao metabolismo de vitaminas e de outros nutrientes?',
    options: QUIZ_OPTIONS,
  },
  {
    id: 'nutri-5',
    block: 'nutrigenetica',
    prompt: 'Deseja personalizar sua alimentação com base em informações genéticas?',
    options: QUIZ_OPTIONS,
  },
  {
    id: 'nutri-6',
    block: 'nutrigenetica',
    prompt:
      'Busca melhorar sua composição corporal, saúde metabólica ou bem-estar por meio da alimentação?',
    options: QUIZ_OPTIONS,
  },
];

/** Conjunto fechado de afirmações, para o DTO recusar id inventado. */
export const QUIZ_STATEMENT_IDS: readonly string[] = QUIZ_STATEMENTS.map(
  (statement) => statement.id,
);

/**
 * Quantas respostas o quiz exige.
 *
 * São todas obrigatórias: o corte em 7 só significa alguma coisa com o bloco
 * inteiro respondido, e o documento não prevê afirmação opcional.
 */
export const QUIZ_STATEMENT_COUNT = QUIZ_STATEMENTS.length;

/** Máximo por bloco: 6 afirmações × 2 pontos. */
export const QUIZ_MAX_PER_BLOCK = 12;

/** Corte do documento: 7 a 12 pontos é interesse declarado no bloco; 0 a 6, não. */
export const QUIZ_CUTOFF = 7;

/** Os três painéis que o quiz pode recomendar, pelo slug do catálogo. */
export const QUIZ_PRODUCT_SLUGS = ['performance', 'nutrigenetica', 'premium'] as const;

export type QuizProductSlug = (typeof QUIZ_PRODUCT_SLUGS)[number];

/**
 * Rótulos dos painéis **dentro do quiz**, conforme a decisão 14 de 09/09 (seguir
 * o material mais recente).
 *
 * Não são os nomes comerciais do catálogo e não devem virar: o `name` do produto
 * no banco aparece no laudo e em pedidos já fechados, e o `slug` viaja em URL e
 * no de/para de painéis do laboratório. Renomear o catálogo é outro assunto, com
 * outro impacto — aqui só se troca a etiqueta que o quiz mostra.
 */
export const QUIZ_PRODUCT_LABELS: Readonly<Record<QuizProductSlug, string>> = {
  performance: 'Painel Performance Esportiva',
  nutrigenetica: 'Painel Nutrigenética',
  premium: 'Painel Completo Performance + Nutrigenética',
};

/**
 * Como o resultado deve ser apresentado.
 *
 * `direta` é o caminho normal. `consulte-treinador` é o quadrante indefinido:
 * ainda vem produto recomendado, mas a tela precisa exibir junto a orientação do
 * documento.
 */
export type QuizGuidance = 'direta' | 'consulte-treinador';

/** Texto do documento para o quadrante indefinido. */
export const QUIZ_GUIDANCE_MESSAGE =
  'Consulte seu treinador, coach ou personal trainer para que ele entenda melhor suas ' +
  'metas e recomende o exame mais adequado.';

export type QuizBlockScores = Readonly<Record<QuizBlock, number>>;

export interface QuizOutcome {
  readonly blocks: QuizBlockScores;
  readonly productSlug: QuizProductSlug;
  readonly guidance: QuizGuidance;
}

/**
 * Soma os pontos de cada bloco.
 *
 * Resposta desconhecida — id de afirmação ou de opção que não existe — é
 * ignorada em silêncio e vale zero. O DTO já barra isso na borda; aqui a
 * tolerância existe para que uma aba velha aberta desde antes da troca do quiz
 * receba uma recomendação em vez de um erro.
 *
 * @param answers - Mapa `statementId → optionId`.
 * @returns Pontuação de 0 a 12 em cada bloco.
 */
export function scoreBlocks(answers: ReadonlyMap<string, string>): QuizBlockScores {
  const totals: Record<QuizBlock, number> = { performance: 0, nutrigenetica: 0 };

  for (const statement of QUIZ_STATEMENTS) {
    const chosen = answers.get(statement.id);
    if (!chosen) continue;

    const option = statement.options.find((candidate) => candidate.id === chosen);
    if (!option) continue;

    totals[statement.block] += option.score;
  }

  return totals;
}

/**
 * Aplica a regra de quadrante do documento.
 *
 * Os três quadrantes definidos são diretos. O quarto — os dois blocos abaixo de
 * 7 — é onde o documento e o cliente se contradizem, e vale a terceira via
 * aprovada por André em 09/09: recomenda-se assim mesmo, pelo bloco de maior
 * pontuação, e a resposta sai marcada com `consulte-treinador`.
 *
 * O empate no quadrante indefinido cai no painel completo, inclusive o 0×0 de
 * quem respondeu "Não" doze vezes. É o desconforto que sobra de somar as duas
 * regras — e é preferível ao que o cliente proibiu, que é não recomendar nada.
 */
export function resolveQuiz(answers: ReadonlyMap<string, string>): QuizOutcome {
  const blocks = scoreBlocks(answers);
  const wantsPerformance = blocks.performance >= QUIZ_CUTOFF;
  const wantsNutrition = blocks.nutrigenetica >= QUIZ_CUTOFF;

  if (wantsPerformance && wantsNutrition) {
    return { blocks, productSlug: 'premium', guidance: 'direta' };
  }
  if (wantsPerformance) {
    return { blocks, productSlug: 'performance', guidance: 'direta' };
  }
  if (wantsNutrition) {
    return { blocks, productSlug: 'nutrigenetica', guidance: 'direta' };
  }

  return {
    blocks,
    productSlug: dominantPanel(blocks),
    guidance: 'consulte-treinador',
  };
}

/**
 * Pontos que cada painel cobre das respostas.
 *
 * Serve para escolher o segundo colocado e para desempatar quando o painel do
 * quadrante não está publicado. O completo cobre a soma dos dois blocos, que é o
 * que ele de fato entrega.
 */
export function coverageBySlug(blocks: QuizBlockScores): Readonly<Record<QuizProductSlug, number>> {
  return {
    performance: blocks.performance,
    nutrigenetica: blocks.nutrigenetica,
    premium: blocks.performance + blocks.nutrigenetica,
  };
}

/**
 * Aderência de 0 a 100: pontos que o painel cobre sobre o máximo que ele poderia
 * cobrir. O completo divide por 24 porque responde pelos dois blocos.
 */
export function affinityFor(slug: QuizProductSlug, blocks: QuizBlockScores): number {
  const covered = coverageBySlug(blocks)[slug];
  const max = slug === 'premium' ? QUIZ_MAX_PER_BLOCK * 2 : QUIZ_MAX_PER_BLOCK;
  return Math.round((covered / max) * 100);
}

function dominantPanel(blocks: QuizBlockScores): QuizProductSlug {
  if (blocks.performance === blocks.nutrigenetica) return 'premium';
  return blocks.performance > blocks.nutrigenetica ? 'performance' : 'nutrigenetica';
}
