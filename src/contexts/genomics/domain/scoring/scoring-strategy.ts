/**
 * Combines the genetic score with the environmental one.
 *
 * The two products use genuinely different mathematics, which is why this is a
 * port with two implementations rather than a flag:
 *
 * - **Performance** adds them, weighted 30/70 in favour of the environment.
 * - **Nutrigenetics** multiplies the genetic score by a modifier between 0.6 and
 *   1.4 derived from the questionnaire.
 *
 * Both honour the same contract when there is no interview: return the genetic
 * score untouched. That is the state the platform is in today — the laboratory
 * has not delivered the environmental algorithm — and the report surfaces it as
 * a preliminary result rather than pretending the number is adjusted.
 */
export interface ScoringStrategy {
  /**
   * @param geneticScore - Normalised genetic score, 20–90.
   * @param environmentalScore - Result of the professional's interview, or null
   *   when no interview has been completed.
   * @returns The adjusted score, on the same scale.
   */
  combine(geneticScore: number, environmentalScore: number | null): number;
}

/**
 * Performance model: `adjusted = genetic × 0.30 + environmental × 0.70`.
 *
 * The 30/70 split is a product decision, not a statistically validated
 * proportion for this 24-marker panel — the specification says so explicitly,
 * and it must appear as a methodological note in the report. The intent is that
 * the client's effort, mediated by the trainer, weighs more than raw genetics.
 */
export class AdditiveScoringStrategy implements ScoringStrategy {
  static readonly GENETIC_WEIGHT = 0.3;
  static readonly ENVIRONMENTAL_WEIGHT = 0.7;

  combine(geneticScore: number, environmentalScore: number | null): number {
    if (environmentalScore === null) return geneticScore;

    const combined =
      geneticScore * AdditiveScoringStrategy.GENETIC_WEIGHT +
      environmentalScore * AdditiveScoringStrategy.ENVIRONMENTAL_WEIGHT;

    return round1(combined);
  }
}

/**
 * Nutrigenetics model: `adjusted = genetic × modifier`.
 *
 * The modifier is the average of the block's questionnaire answers, each worth
 * between 0.6 (worst) and 1.4 (best).
 *
 * The product is clamped to the scale ceiling: a modifier of 1.4 on a score of
 * 85 would otherwise yield 119, which has no meaning on a 20–90 scale and would
 * break every band and progress bar downstream.
 */
export class MultiplicativeScoringStrategy implements ScoringStrategy {
  static readonly MIN_MODIFIER = 0.6;
  static readonly MAX_MODIFIER = 1.4;

  constructor(
    private readonly floor: number,
    private readonly ceiling: number,
  ) {}

  combine(geneticScore: number, environmentalScore: number | null): number {
    if (environmentalScore === null) return geneticScore;

    const modifier = clamp(
      environmentalScore,
      MultiplicativeScoringStrategy.MIN_MODIFIER,
      MultiplicativeScoringStrategy.MAX_MODIFIER,
    );

    return round1(clamp(geneticScore * modifier, this.floor, this.ceiling));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
