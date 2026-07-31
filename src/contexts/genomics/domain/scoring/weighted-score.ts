/** A marker's contribution: the score of the observed genotype and its weight. */
export interface WeightedMarker {
  readonly rsId: string;
  readonly score: number;
  readonly weight: number;
}

/**
 * Weighted average of the markers in a category.
 *
 * Two details that are easy to get wrong and change the result:
 *
 * **Missing markers renormalise the denominator.** If a CSV lacks one of the
 * four markers in a category, the remaining three are averaged over their own
 * weights, not over the full 1.0. Dividing by the full weight would silently
 * push the score down and make an incomplete exam look like a bad result.
 *
 * **Weights need not sum to 1.** They are normalised here, so the laboratory can
 * edit a weight in the admin without having to rebalance the others by hand.
 *
 * @param markers - Markers actually observed for this subject.
 * @returns The weighted average, or null when no marker was observed.
 */
export function weightedAverage(markers: readonly WeightedMarker[]): number | null {
  if (markers.length === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const marker of markers) {
    weightedSum += marker.score * marker.weight;
    totalWeight += marker.weight;
  }

  if (totalWeight === 0) return null;

  return weightedSum / totalWeight;
}
