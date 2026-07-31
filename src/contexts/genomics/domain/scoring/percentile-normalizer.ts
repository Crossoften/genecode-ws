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
  normalize(rawScore: number): number {
    const percentile = this.percentileOf(rawScore);
    const scaled = SCORE_MIN + (percentile / 100) * (SCORE_MAX - SCORE_MIN);
    return Math.round(scaled * 10) / 10;
  }

  /**
   * Finds the population percentile of a raw score by linear interpolation
   * between the two surrounding points of the curve.
   *
   * Scores outside the observed range clamp to the extremes rather than
   * extrapolating: beyond the curve there is no population data to justify a
   * number, and extrapolating would invent one.
   */
  percentileOf(rawScore: number): number {
    if (this.curve.length === 0) {
      // No curve means no basis for a percentile. Returning the median is the
      // only neutral answer — and the seed guarantees a curve exists, so this
      // is a guard, not a normal path.
      return 50;
    }

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
