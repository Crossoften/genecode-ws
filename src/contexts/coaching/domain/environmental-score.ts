import {
  AdditiveScoringStrategy,
  MultiplicativeScoringStrategy,
  type ScoringStrategy,
} from '@contexts/genomics/domain/scoring/scoring-strategy';

/**
 * Turns questionnaire answers into the environmental adjustment of the report.
 *
 * The chain is deliberate and keeps the validated genetic engine untouched:
 *
 *   answers → quality per category (0–1) → environmental score 0–100 →
 *   `ScoringStrategy.combine(genetic, …)` → adjusted score.
 *
 * The person authoring questions works in ONE intuitive scale — each option is
 * worth 0 (worst habit) to 100 (best) — and the mapping to each product's math
 * (additive on performance, multiplicative on nutrigenetics) happens here, so
 * the two models the specification defines are reused, not reinvented.
 */

/** Uma pergunta com peso, ligada a um grupo genético. */
export interface WeightedQuestion {
  readonly id: string;
  readonly categorySlug: string;
  readonly weight: number;
  /** id da opção → pontos (0–100). */
  readonly optionPoints: ReadonlyMap<string, number>;
}

/** Uma resposta: a opção escolhida para uma pergunta. */
export interface Answer {
  readonly questionId: string;
  readonly optionId: string;
}

/** Máximo de pontos que uma resposta pode valer. */
export const MAX_POINTS = 100;

/**
 * Chooses the combination model for a panel.
 *
 * Performance adds genetic and environmental 30/70; nutrigenetics multiplies the
 * genetic score by a modifier. Nutrigenetics is clamped to the 20–90 scale so a
 * high modifier cannot push a score off the bands and progress bars downstream.
 */
export function strategyForPanel(panelSlug: string): ScoringStrategy {
  if (panelSlug === 'performance') return new AdditiveScoringStrategy();
  return new MultiplicativeScoringStrategy(20, 90);
}

/**
 * Mapeia a qualidade de hábito (0–1) para o escore ambiental.
 *
 * Escala 0–100 para os dois painéis — decisão 25 do André em 09/09, alinhando o
 * cálculo à especificação do laboratório (§3.3/§3.4: a posição da opção vale
 * 100 / 66,7 / 33,3 / 0 e o ambiental da categoria é a média das 4 perguntas do
 * bloco). Antes disso o performance era espremido em 20–90, a mesma faixa do
 * genético; o efeito colateral era que um cliente com hábitos péssimos ainda
 * levava 20 pontos de brinde, e o paciente — que passa a ver os três escores —
 * não teria como conferir a conta contra o laudo.
 *
 * A nutrigenética continua multiplicativa, mas o número GRAVADO e exibido é o
 * ambiental 0–100; a conversão para o modificador é interna
 * ({@link environmentalToModifier}), para que "escore ambiental" signifique a
 * mesma coisa nos dois produtos.
 */
export function qualityToEnvironmental(quality: number): number {
  return round1(clamp(quality, 0, 1) * MAX_POINTS);
}

/**
 * Converte o ambiental 0–100 no modificador 0,6–1,4 da nutrigenética.
 *
 * Fica aqui, e não na estratégia, porque é tradução de escala e não regra de
 * combinação: a `MultiplicativeScoringStrategy` continua recebendo o modificador
 * que ela sempre esperou.
 */
function environmentalToModifier(environmental: number): number {
  return round2(
    MultiplicativeScoringStrategy.MIN_MODIFIER +
      (environmental / MAX_POINTS) *
        (MultiplicativeScoringStrategy.MAX_MODIFIER - MultiplicativeScoringStrategy.MIN_MODIFIER),
  );
}

export interface CategoryEnvironmental {
  /** Escore ambiental da categoria, 0–100 nos dois painéis. */
  readonly environmental: number;
  /** Score ajustado final, combinando genético e ambiental. */
  readonly adjusted: number;
}

/**
 * Computes the environmental and adjusted score for one category.
 *
 * Quality is the weighted average of the chosen options' points over the
 * maximum, so a category with no answered question yields no adjustment (the
 * caller then leaves that category preliminary).
 *
 * @returns null when no question of this category was answered.
 */
export function scoreCategory(
  panelSlug: string,
  geneticScore: number,
  questions: readonly WeightedQuestion[],
  answersByQuestion: ReadonlyMap<string, string>,
): CategoryEnvironmental | null {
  let weighted = 0;
  let totalWeight = 0;

  for (const question of questions) {
    const optionId = answersByQuestion.get(question.id);
    if (optionId === undefined) continue;
    const points = question.optionPoints.get(optionId);
    if (points === undefined) continue;
    weighted += (points / MAX_POINTS) * question.weight;
    totalWeight += question.weight;
  }

  if (totalWeight === 0) return null;

  const quality = clamp(weighted / totalWeight, 0, 1);
  const environmental = qualityToEnvironmental(quality);
  const combinable =
    panelSlug === 'performance' ? environmental : environmentalToModifier(environmental);
  const adjusted = strategyForPanel(panelSlug).combine(geneticScore, combinable);
  return { environmental, adjusted };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
