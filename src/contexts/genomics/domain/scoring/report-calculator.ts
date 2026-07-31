import { GenotypeNormalizer, type GenotypeAliasMap } from './genotype-normalizer';
import { PercentileNormalizer, type PercentilePoint } from './percentile-normalizer';
import { ScoreBand, bandFor } from './score-band';
import { weightedAverage, type WeightedMarker } from './weighted-score';

/** A marker inside a category, with its weight and the score of each genotype. */
export interface MarkerDefinition {
  readonly rsId: string;
  readonly weight: number;
  /** Canonical genotype → score. Scoped to the panel: the same marker can have
   *  opposite polarity in another panel (SOD2 rs4880 does). */
  readonly genotypeScores: ReadonlyMap<string, number>;
}

export interface CategoryDefinition {
  readonly slug: string;
  readonly markers: readonly MarkerDefinition[];
  readonly percentileCurve: readonly PercentilePoint[];
}

export interface ModalityDefinition {
  readonly slug: string;
  readonly isGlobal: boolean;
  /** Category slug → weight within this modality. */
  readonly categoryWeights: ReadonlyMap<string, number>;
  /** Curve of the composite index itself. See the note on renormalisation below. */
  readonly percentileCurve: readonly PercentilePoint[];
}

export interface PanelDefinition {
  readonly slug: string;
  readonly categories: readonly CategoryDefinition[];
  readonly modalities: readonly ModalityDefinition[];
  readonly aliases: readonly GenotypeAliasMap[];
}

export interface CategoryResult {
  readonly slug: string;
  readonly rawScore: number;
  readonly normalizedScore: number;
  readonly band: ScoreBand;
  /** Markers expected by the panel but absent from the input. */
  readonly missingMarkers: readonly string[];
}

export interface ModalityResult {
  readonly slug: string;
  readonly isGlobal: boolean;
  readonly rawIndex: number;
  readonly normalizedIndex: number;
  readonly band: ScoreBand;
}

export interface CalculationResult {
  readonly categories: readonly CategoryResult[];
  readonly modalities: readonly ModalityResult[];
  readonly missingMarkers: readonly string[];
  /** Genotypes that could not be resolved, with the reason. */
  readonly rejectedMarkers: readonly { rsId: string; rawValue: string; reason: string }[];
}

/**
 * Turns a subject's raw genotypes into a full set of scores.
 *
 * The pipeline, per category:
 *
 *   genotypes → canonical form → score per marker → weighted average
 *             → population percentile → 20–90 scale → band
 *
 * and then, per modality:
 *
 *   category scores → weighted average by modality → percentile → 20–90 → band
 *
 * ### Why the composite index is normalised too
 *
 * The Global index is an average of six categories, and averaging regresses to
 * the mean. Measured on the 80 real patients, category scores spanned 20–90 but
 * the Global index only spanned 37.6–79.6. A Monte Carlo run over 50,000
 * synthetic individuals confirmed it: half the population sits inside a
 * twelve-point band.
 *
 * Left uncorrected, the report would suggest nobody ever scores well. Running
 * the composite through its own percentile curve restores the full range and
 * lets the same bands apply to every number on the page.
 */
export class ReportCalculator {
  private readonly normalizer: GenotypeNormalizer;

  constructor(private readonly panel: PanelDefinition) {
    this.normalizer = new GenotypeNormalizer(panel.aliases);
  }

  /**
   * Computes every score for one subject.
   *
   * @param rawGenotypes - rsId → genotype exactly as it came from the CSV.
   * @returns Category scores, modality indexes, and the markers that were
   *   missing or rejected — never silently omitted.
   */
  calculate(rawGenotypes: ReadonlyMap<string, string>): CalculationResult {
    const resolved = new Map<string, string>();
    const rejected: { rsId: string; rawValue: string; reason: string }[] = [];

    for (const [rsId, rawValue] of rawGenotypes) {
      const normalised = this.normalizer.normalize(rsId, rawValue);
      if (normalised.isOk()) {
        resolved.set(rsId.toLowerCase(), normalised.value);
      } else {
        rejected.push({ rsId, rawValue, reason: normalised.error.message });
      }
    }

    const categories: CategoryResult[] = [];
    const missingOverall: string[] = [];
    // Keeps normalised category scores for the modality step below.
    const normalisedByCategory = new Map<string, number>();

    for (const category of this.panel.categories) {
      const present: WeightedMarker[] = [];
      const missing: string[] = [];

      for (const marker of category.markers) {
        const genotype = resolved.get(marker.rsId.toLowerCase());
        const score = genotype === undefined ? undefined : marker.genotypeScores.get(genotype);

        if (score === undefined) {
          missing.push(marker.rsId);
          continue;
        }
        present.push({ rsId: marker.rsId, score, weight: marker.weight });
      }

      missingOverall.push(...missing);

      const rawScore = weightedAverage(present);
      // A category with no usable marker is skipped entirely rather than
      // reported as zero — zero would read as "worst possible result".
      if (rawScore === null) continue;

      const normalizedScore = new PercentileNormalizer(category.percentileCurve).normalize(rawScore);
      normalisedByCategory.set(category.slug, normalizedScore);

      categories.push({
        slug: category.slug,
        rawScore: round4(rawScore),
        normalizedScore,
        band: bandFor(normalizedScore),
        missingMarkers: missing,
      });
    }

    const modalities = this.panel.modalities
      .map((modality) => this.calculateModality(modality, normalisedByCategory))
      .filter((result): result is ModalityResult => result !== null);

    return {
      categories,
      modalities,
      missingMarkers: missingOverall,
      rejectedMarkers: rejected,
    };
  }

  /**
   * Computes one composite index from the already normalised category scores.
   *
   * Categories weighted zero are skipped, not counted as absent — E-Sports
   * legitimately assigns 0% to strength, and including it would drag the
   * denominator down for no reason.
   */
  private calculateModality(
    modality: ModalityDefinition,
    normalisedByCategory: ReadonlyMap<string, number>,
  ): ModalityResult | null {
    const contributions: WeightedMarker[] = [];

    for (const [categorySlug, weight] of modality.categoryWeights) {
      if (weight <= 0) continue;
      const score = normalisedByCategory.get(categorySlug);
      if (score === undefined) continue;
      contributions.push({ rsId: categorySlug, score, weight });
    }

    const rawIndex = weightedAverage(contributions);
    if (rawIndex === null) return null;

    const normalizedIndex = new PercentileNormalizer(modality.percentileCurve).normalize(rawIndex);

    return {
      slug: modality.slug,
      isGlobal: modality.isGlobal,
      rawIndex: round4(rawIndex),
      normalizedIndex,
      band: bandFor(normalizedIndex),
    };
  }
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
