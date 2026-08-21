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
 *   answers → quality per category (0–1) → environmental score on the strategy's
 *   scale → `ScoringStrategy.combine(genetic, environmental)` → adjusted score.
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
 * Maps a 0–1 habit quality to the environmental score the strategy expects.
 *
 * - Performance (additive): 20–90, same population scale as the genetic score.
 * - Nutrigenetics (multiplicative): 0.6–1.4 modifier.
 */
export function qualityToEnvironmental(panelSlug: string, quality: number): number {
  if (panelSlug === 'performance') return round1(20 + quality * 70);
  return round2(0.6 + quality * 0.8);
}

export interface CategoryEnvironmental {
  /** Score ambiental na escala da estratégia (20–90 ou 0,6–1,4). */
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
  const environmental = qualityToEnvironmental(panelSlug, quality);
  const adjusted = strategyForPanel(panelSlug).combine(geneticScore, environmental);
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
