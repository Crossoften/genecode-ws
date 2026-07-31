import { COMPOSITE_RULES } from './composite-marker';
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

/**
 * Marcador composto dentro de uma categoria.
 *
 * Referencia uma regra nomeada em `composite-marker.ts` — MTHFR e HFE são os
 * dois casos do painel, em que dois SNPs só têm significado clínico juntos.
 */
export interface CompositeDefinition {
  /** Chave da regra: `mthfr` ou `hfe`. */
  readonly key: string;
  readonly weight: number;
}

export interface CategoryDefinition {
  readonly slug: string;
  readonly markers: readonly MarkerDefinition[];
  /** Marcadores compostos, se a categoria tiver algum. */
  readonly composites?: readonly CompositeDefinition[];
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
  /** Markers the panel expects but the input did not contain at all. */
  readonly missingMarkers: readonly string[];
  /** Genotypes that could not be normalised, with the reason. */
  readonly rejectedMarkers: readonly { rsId: string; rawValue: string; reason: string }[];
  /**
   * Markers whose genotype WAS supplied and normalised, but has no score in this
   * panel.
   *
   * Kept separate from `missingMarkers` on purpose. An absent column is a
   * legitimately incomplete exam; a supplied genotype the panel cannot score is
   * a data defect — wrong notation, wrong panel, or a stale alias mapping. The
   * distinction exists because conflating the two once let a real bug through:
   * BDNF rs6265 resolved to the nutrigenetics spelling inside the performance
   * panel, was filed as "missing", and a report went out without it.
   */
  readonly unmatchedMarkers: readonly { rsId: string; genotype: string }[];
  /**
   * Categorias omitidas por falta de curva populacional.
   *
   * Sem a curva não há como converter o escore bruto em percentil, e apresentar
   * um número não calibrado como se fosse escore populacional seria enganoso.
   */
  readonly uncalibratedCategories: readonly string[];
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
    // Mesmo conteúdo, indexado pelo rsId como escrito — as regras compostas
    // consultam por `rs1801133`, não por `rs1801133` em minúsculas de um lado e
    // maiúsculas de outro.
    const resolvedByRsId = new Map<string, string>();
    const rejected: { rsId: string; rawValue: string; reason: string }[] = [];

    for (const [rsId, rawValue] of rawGenotypes) {
      const normalised = this.normalizer.normalize(rsId, rawValue);
      if (normalised.isOk()) {
        resolved.set(rsId.toLowerCase(), normalised.value);
        resolvedByRsId.set(rsId, normalised.value);
      } else {
        rejected.push({ rsId, rawValue, reason: normalised.error.message });
      }
    }

    const categories: CategoryResult[] = [];
    const missingOverall: string[] = [];
    const unmatched: { rsId: string; genotype: string }[] = [];
    const uncalibrated: string[] = [];
    // Keeps normalised category scores for the modality step below.
    const normalisedByCategory = new Map<string, number>();

    for (const category of this.panel.categories) {
      const present: WeightedMarker[] = [];
      const missing: string[] = [];

      for (const marker of category.markers) {
        const genotype = resolved.get(marker.rsId.toLowerCase());

        if (genotype === undefined) {
          missing.push(marker.rsId);
          continue;
        }

        const score = marker.genotypeScores.get(genotype);
        if (score === undefined) {
          // Genótipo veio e foi normalizado, mas o painel não sabe pontuá-lo.
          // Isso é defeito de dado, e quem chama precisa tratar como erro.
          unmatched.push({ rsId: marker.rsId, genotype });
          missing.push(marker.rsId);
          continue;
        }

        present.push({ rsId: marker.rsId, score, weight: marker.weight });
      }

      // Compostos entram na mesma média ponderada dos marcadores simples: são
      // uma contribuição a mais na categoria, com peso próprio.
      for (const composite of category.composites ?? []) {
        const rule = COMPOSITE_RULES.get(composite.key);
        if (!rule) continue;

        const score = rule.evaluate({ genotypes: resolvedByRsId });
        if (score === null) {
          missing.push(...rule.rsIds);
          continue;
        }
        present.push({ rsId: composite.key, score, weight: composite.weight });
      }

      missingOverall.push(...missing);

      const rawScore = weightedAverage(present);
      // A category with no usable marker is skipped entirely rather than
      // reported as zero — zero would read as "worst possible result".
      if (rawScore === null) continue;

      const normalizedScore = new PercentileNormalizer(category.percentileCurve).normalize(rawScore);
      if (normalizedScore === null) {
        // Categoria sem curva populacional não pode ser apresentada como escore
        // normalizado. Omitir é honesto; inventar um número não é.
        uncalibrated.push(category.slug);
        continue;
      }
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
      unmatchedMarkers: unmatched,
      uncalibratedCategories: uncalibrated,
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

    const normalizer = new PercentileNormalizer(modality.percentileCurve);
    // Sem curva simulada, o índice bruto é usado como está. Ele já está na
    // escala 20–90 por ser média de categorias normalizadas — só não está
    // reancorado na distribuição populacional, o que significa que fica
    // comprimido perto da mediana. É uma aproximação declarada, não um valor
    // inventado.
    const normalizedIndex = normalizer.normalize(rawIndex) ?? Math.round(rawIndex * 10) / 10;

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
