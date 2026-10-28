/**
 * Classification band of a normalised score.
 *
 * Three bands, as the client set them on 20/10/2026 (GC-AJ-014) and wrote in
 * the result-matrix guide: *"baixa ≤ 33; intermediária > 33 a 66; alta > 66"*.
 *
 * The cuts apply to the **number the patient sees** (the 20–90 scale), not to
 * the population percentile behind it. The guide's own worked example settles
 * it: a 42 is called "intermediária", which only holds on the displayed number
 * (on the percentile, 42 would sit in the lowest third).
 *
 * The previous four quartile bands (73/55/38) were replaced, and the migration
 * `20261028_tres_faixas` re-derived the band of every stored score from its
 * number, so no report keeps a label from the old scale.
 */
export enum ScoreBand {
  FAVORAVEL = 'FAVORAVEL',
  INTERMEDIARIO = 'INTERMEDIARIO',
  DESFAVORAVEL = 'DESFAVORAVEL',
}

/** Bounds of the normalised scale produced by the population percentile step. */
export const SCORE_MIN = 20;
export const SCORE_MAX = 90;

/** Above this number the score is FAVORAVEL. */
export const UPPER_CUT = 66;
/** Above this number (and up to UPPER_CUT) the score is INTERMEDIARIO. */
export const LOWER_CUT = 33;

/**
 * Resolves the band a normalised score falls into.
 *
 * Both cuts are exclusive on the way up, exactly as the guide writes them:
 * 33 is still DESFAVORAVEL and 66 is still INTERMEDIARIO.
 *
 * @param normalisedScore - A value on the 20–90 scale.
 */
export function bandFor(normalisedScore: number): ScoreBand {
  if (normalisedScore > UPPER_CUT) return ScoreBand.FAVORAVEL;
  if (normalisedScore > LOWER_CUT) return ScoreBand.INTERMEDIARIO;
  return ScoreBand.DESFAVORAVEL;
}
