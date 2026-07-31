import { SCORE_MAX, SCORE_MIN } from './score-band';

/** One point of a population percentile curve: a raw score and its percentile. */
export interface PercentilePoint {
  readonly rawScore: number;
  readonly percentile: number;
}

/**
 * Converts a raw weighted score into a population percentile, then onto the
 * 20–90 scale the patient sees.
 *
 * Why normalise at all: a raw weighted sum is only meaningful against the
 * distribution it came from. Telling someone they scored 62 says nothing;
 * telling them 62 puts them above 60% of the population does. The laboratory
 * built these curves analytically from GnomAD allele frequencies via
 * Hardy-Weinberg, and this class only interpolates them.
 *
 * The curve must be sorted ascending by `rawScore` — the caller guarantees it,
 * since it comes indexed from the database.
 */
export class PercentileNormalizer {
  constructor(private readonly curve: readonly PercentilePoint[]) {}

  /**
   * Maps a raw score onto the normalised 20–90 scale.
   *
   * @param rawScore - Weighted sum produced by a scoring strategy.
   * @returns The normalised score, rounded to one decimal.
   */
  normalize(rawScore: number): number | null {
    const percentile = this.percentileOf(rawScore);
    if (percentile === null) return null;

    const scaled = SCORE_MIN + (percentile / 100) * (SCORE_MAX - SCORE_MIN);
    return Math.round(scaled * 10) / 10;
  }

  /** True quando há curva populacional para normalizar. */
  get hasCurve(): boolean {
    return this.curve.length > 0;
  }

  /**
   * Finds the population percentile of a raw score by linear interpolation
   * between the two surrounding points of the curve.
   *
   * Scores outside the observed range clamp to the extremes rather than
   * extrapolating: beyond the curve there is no population data to justify a
   * number, and extrapolating would invent one.
   */
  percentileOf(rawScore: number): number | null {
    // Sem curva não há base para percentil algum.
    //
    // A primeira versão devolvia 50 aqui, tratando isso como guarda defensiva.
    // Não era: o painel de nutrigenética não tinha curva para o índice composto,
    // e todo paciente recebia exatamente 55 — inclusive um com todas as
    // categorias em 90 e outro com todas em 20. Um número plausível e idêntico
    // para todo mundo é pior que erro nenhum, porque ninguém desconfia dele.
    //
    // Devolver null obriga quem chama a decidir o que fazer.
    if (this.curve.length === 0) return null;

    const first = this.curve[0]!;
    const last = this.curve[this.curve.length - 1]!;

    if (rawScore <= first.rawScore) return first.percentile;
    if (rawScore >= last.rawScore) return last.percentile;

    const upperIndex = this.findUpperBound(rawScore);
    const upper = this.curve[upperIndex]!;
    const lower = this.curve[upperIndex - 1]!;

    const span = upper.rawScore - lower.rawScore;
    // Two points sharing a raw score would divide by zero; take the upper one.
    if (span === 0) return upper.percentile;

    const ratio = (rawScore - lower.rawScore) / span;
    return lower.percentile + ratio * (upper.percentile - lower.percentile);
  }

  /**
   * Binary search for the first curve point whose raw score is >= the target.
   *
   * The Python reference walked the curve linearly. These tables have thousands
   * of points and are consulted once per category per patient, so on a batch of
   * 80 patients it is the difference between a few thousand comparisons and a
   * few hundred thousand.
   */
  private findUpperBound(rawScore: number): number {
    let low = 1;
    let high = this.curve.length - 1;

    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.curve[mid]!.rawScore >= rawScore) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    return low;
  }
}
