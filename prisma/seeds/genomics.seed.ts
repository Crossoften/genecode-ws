import { PrismaClient, type Classification, type PanelKind, type ScoringModel } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GenotypeNormalizer } from '../../src/contexts/genomics/domain/scoring/genotype-normalizer';

const DATA_DIR = join(__dirname, 'data');

interface GenotypeScoreJson {
  genotype: string;
  score: number;
  classification: Classification;
}

interface MarkerJson {
  rsId: string;
  weight: number;
  position: number;
  genotypeScores: GenotypeScoreJson[];
}

interface CategoryJson {
  slug: string;
  name: string;
  position: number;
  markers: MarkerJson[];
  percentileCurve: { rawScore: number; percentile: number }[];
}

interface ModalityJson {
  slug: string;
  name: string;
  isGlobal: boolean;
  position: number;
  categoryWeights: { category: string; weight: number }[];
}

interface PanelJson {
  slug: string;
  version: string;
  name: string;
  kind: PanelKind;
  scoringModel: ScoringModel;
  snps: { rsId: string; gene: string }[];
  categories: CategoryJson[];
  modalities: ModalityJson[];
}

/**
 * Loads the genetic panels into the database.
 *
 * The source of truth for this data is the laboratory's own Python algorithms
 * and spreadsheets; `scripts/export-panels.py` converts them to the JSON read
 * here, applying the decisions recorded in `docs/01-produto/04-decisoes.md`:
 * corrected neuro weights, LPL redistributed, ADRB3 polarity resolved.
 *
 * Idempotent by panel version. Publishing a new panel version means exporting
 * with a bumped version — never editing a published one, because reports pin the
 * version they were computed with.
 */
export async function seedGenomics(prisma: PrismaClient): Promise<void> {
  for (const file of ['panel-performance.json', 'panel-nutrigenetics.json']) {
    const panel = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as PanelJson;
    await seedPanel(prisma, panel);
  }
}

async function seedPanel(prisma: PrismaClient, json: PanelJson): Promise<void> {
  const existing = await prisma.panel.findUnique({
    where: { slug_version: { slug: json.slug, version: json.version } },
  });

  if (existing?.status === 'PUBLISHED') {
    console.log(`· painel ${json.slug} v${json.version} já publicado — preservado`);
    return;
  }

  // Recria a versão em rascunho do zero: um seed parcial deixaria pesos antigos
  // convivendo com novos, e o erro só apareceria num escore torto muito depois.
  if (existing) {
    await prisma.panel.delete({ where: { id: existing.id } });
  }

  const panel = await prisma.panel.create({
    data: {
      slug: json.slug,
      version: json.version,
      name: json.name,
      kind: json.kind,
      scoringModel: json.scoringModel,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  await seedSnps(prisma, json);

  const snpIds = await mapSnpIds(prisma, json.snps.map((s) => s.rsId));
  const categoryIds = new Map<string, string>();

  for (const category of json.categories) {
    const record = await prisma.panelCategory.create({
      data: {
        panelId: panel.id,
        slug: category.slug,
        name: category.name,
        position: category.position,
      },
    });
    categoryIds.set(category.slug, record.id);

    for (const marker of category.markers) {
      const snpId = snpIds.get(marker.rsId);
      if (!snpId) throw new Error(`SNP ${marker.rsId} não foi semeado`);

      const panelSnp = await prisma.panelSnp.create({
        data: {
          panelId: panel.id,
          snpId,
          categoryId: record.id,
          weight: marker.weight,
          position: marker.position,
        },
      });

      await prisma.genotypeScore.createMany({
        data: marker.genotypeScores.map((gs) => ({
          panelSnpId: panelSnp.id,
          genotype: gs.genotype,
          score: gs.score,
          classification: gs.classification,
        })),
      });
    }

    if (category.percentileCurve.length > 0) {
      await prisma.percentilePoint.createMany({
        data: category.percentileCurve.map((point) => ({
          categoryId: record.id,
          rawScore: point.rawScore,
          percentile: point.percentile,
        })),
      });
    }
  }

  await seedModalities(prisma, panel.id, json, categoryIds);

  console.log(
    `✓ painel ${json.slug} v${json.version}: ${json.snps.length} SNPs, ` +
      `${json.categories.length} categorias, ${json.modalities.length} modalidades`,
  );
}

/**
 * Creates the markers and their accepted genotype spellings.
 *
 * The alias table is what prevents a marker from being silently dropped when the
 * laboratory reports it on the opposite DNA strand — see the BDNF rs6265 case in
 * `GenotypeNormalizer`.
 */
async function seedSnps(prisma: PrismaClient, json: PanelJson): Promise<void> {
  for (const snp of json.snps) {
    const record = await prisma.snp.upsert({
      where: { rsId: snp.rsId },
      update: { gene: snp.gene },
      create: { rsId: snp.rsId, gene: snp.gene },
    });

    const canonical = json.categories
      .flatMap((c) => c.markers)
      .filter((m) => m.rsId === snp.rsId)
      .flatMap((m) => m.genotypeScores.map((gs) => gs.genotype));

    if (canonical.length === 0) continue;

    const { aliases } = GenotypeNormalizer.buildAliases(snp.rsId, canonical);

    await prisma.genotypeAlias.deleteMany({ where: { snpId: record.id } });
    await prisma.genotypeAlias.createMany({
      data: [...aliases].map(([alias, canonicalValue]) => ({
        snpId: record.id,
        alias,
        canonical: canonicalValue,
      })),
    });
  }
}

/** Resolves rsIds to their database ids in a single query. */
async function mapSnpIds(
  prisma: PrismaClient,
  rsIds: readonly string[],
): Promise<Map<string, string>> {
  const records = await prisma.snp.findMany({
    where: { rsId: { in: [...rsIds] } },
    select: { id: true, rsId: true },
  });
  return new Map(records.map((r) => [r.rsId, r.id]));
}

async function seedModalities(
  prisma: PrismaClient,
  panelId: string,
  json: PanelJson,
  categoryIds: ReadonlyMap<string, string>,
): Promise<void> {
  const curves = loadModalityCurves(json.slug);

  for (const modality of json.modalities) {
    const record = await prisma.modality.create({
      data: {
        panelId,
        slug: modality.slug,
        name: modality.name,
        isGlobal: modality.isGlobal,
        position: modality.position,
      },
    });

    await prisma.modalityWeight.createMany({
      data: modality.categoryWeights
        .filter((cw) => categoryIds.has(cw.category))
        .map((cw) => ({
          modalityId: record.id,
          categoryId: categoryIds.get(cw.category)!,
          weight: cw.weight,
        })),
    });

    const curve = curves[modality.slug];
    if (curve && curve.length > 0) {
      await prisma.percentilePoint.createMany({
        data: curve.map((point) => ({
          modalityId: record.id,
          rawScore: point.rawScore,
          percentile: point.percentile,
        })),
      });
    }
  }
}

/**
 * Percentile curves for the composite indexes, produced by Monte Carlo.
 *
 * Category curves come from Hardy-Weinberg analytically, but a composite index
 * mixes six correlated categories and has no closed form — so its distribution
 * is simulated from the genotype frequencies instead.
 *
 * Without these curves the Global index would stay compressed around the median:
 * measured on the real data it spanned only 42–70 between the 5th and 95th
 * percentiles, which would read as "nobody ever scores well".
 */
function loadModalityCurves(
  panelSlug: string,
): Record<string, { rawScore: number; percentile: number }[]> {
  try {
    const raw = readFileSync(join(DATA_DIR, `modality-percentiles-${panelSlug}.json`), 'utf8');
    return JSON.parse(raw) as Record<string, { rawScore: number; percentile: number }[]>;
  } catch {
    // Nutrigenetics has a single index and no simulated curve yet — it falls
    // back to the raw composite, which is acceptable for one aggregate.
    return {};
  }
}
