/**
 * Classification band of a normalised score.
 *
 * The bands are anchored on the quartiles of the population normalisation, not
 * chosen arbitrarily. Since the pipeline computes
 *
 *     score = MIN + percentile × (MAX - MIN)   →   20 + percentile × 0.70
 *
 * the quartiles land exactly on 37.5, 55 and 72.5. A patient in FAVORAVEL is, by
 * construction, in the top quarter of the population.
 *
 * The client's original bands (0–34 / 35–54 / 55–79 / 80–100) had two
 * unreachable stretches: no score ever leaves the 20–90 range, so nobody could
 * be "critical" and nobody could reach 100.
 */
export enum ScoreBand {
  FAVORAVEL = 'FAVORAVEL',
  MODERADO = 'MODERADO',
  ATENCAO = 'ATENCAO',
  PRIORIDADE = 'PRIORIDADE',
}

/** Bounds of the normalised scale produced by the population percentile step. */
export const SCORE_MIN = 20;
export const SCORE_MAX = 90;

/** Lower bound of each band, in descending order. */
const BAND_FLOORS: ReadonlyArray<readonly [ScoreBand, number]> = [
  [ScoreBand.FAVORAVEL, 73],
  [ScoreBand.MODERADO, 55],
  [ScoreBand.ATENCAO, 38],
  [ScoreBand.PRIORIDADE, Number.NEGATIVE_INFINITY],
];

/**
 * Resolves the band a normalised score falls into.
 *
 * @param normalisedScore - A value on the 20–90 scale.
 */
export function bandFor(normalisedScore: number): ScoreBand {
  const match = BAND_FLOORS.find(([, floor]) => normalisedScore >= floor);
  // The last entry has a floor of -Infinity, so this is always defined. The
  // fallback exists only to satisfy the compiler under noUncheckedIndexedAccess.
  return match?.[0] ?? ScoreBand.PRIORIDADE;
}
