import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '@infra/database/prisma.service';

import type { LoadedPanel, PanelRepository } from '../../domain/ports/panel.repository';
import { GenotypeNormalizer, type GenotypeAliasMap } from '../../domain/scoring/genotype-normalizer';
import type {
  CategoryDefinition,
  ModalityDefinition,
  PanelDefinition,
} from '../../domain/scoring/report-calculator';

/** Everything a panel needs, in one query tree. */
const PANEL_INCLUDE = {
  categories: {
    orderBy: { position: 'asc' },
    include: {
      snps: {
        orderBy: { position: 'asc' },
        include: {
          snp: true,
          genotypeScores: true,
        },
      },
      percentiles: { orderBy: { rawScore: 'asc' } },
    },
  },
  modalities: {
    orderBy: { position: 'asc' },
    include: {
      weights: { include: { category: { select: { slug: true } } } },
      percentiles: { orderBy: { rawScore: 'asc' } },
    },
  },
} as const;

/** Painel com tudo que o include acima traz, tipado a partir do próprio Prisma. */
type PanelWithRelations = Prisma.PanelGetPayload<{ include: typeof PANEL_INCLUDE }>;

/**
 * Prisma-backed implementation of {@link PanelRepository}.
 *
 * Deliberately one large read. A panel is a few hundred rows and is loaded once
 * per batch, so the round trips saved outweigh the size of the result — and the
 * calculator receiving a complete, immutable definition is what allows it to
 * stay free of I/O.
 */
@Injectable()
export class PrismaPanelRepository implements PanelRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadPublished(slug: string): Promise<LoadedPanel | null> {
    const panel = await this.prisma.panel.findFirst({
      where: { slug, status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      include: PANEL_INCLUDE,
    });
    return panel ? this.toLoadedPanel(panel) : null;
  }

  async loadById(panelId: string): Promise<LoadedPanel | null> {
    const panel = await this.prisma.panel.findUnique({
      where: { id: panelId },
      include: PANEL_INCLUDE,
    });
    return panel ? this.toLoadedPanel(panel) : null;
  }

  private toLoadedPanel(panel: PanelWithRelations): LoadedPanel {
    const categories: CategoryDefinition[] = panel.categories.map((category) => ({
      slug: category.slug,
      percentileCurve: category.percentiles.map((point) => ({
        rawScore: Number(point.rawScore),
        percentile: Number(point.percentile),
      })),
      markers: category.snps.map((panelSnp) => ({
        rsId: panelSnp.snp.rsId,
        weight: Number(panelSnp.weight),
        genotypeScores: new Map(
          panelSnp.genotypeScores.map((gs) => [gs.genotype, Number(gs.score)]),
        ),
      })),
    }));

    const modalities: ModalityDefinition[] = panel.modalities.map((modality) => ({
      slug: modality.slug,
      isGlobal: modality.isGlobal,
      categoryWeights: new Map(
        modality.weights.map((weight) => [weight.category.slug, Number(weight.weight)]),
      ),
      percentileCurve: modality.percentiles.map((point) => ({
        rawScore: Number(point.rawScore),
        percentile: Number(point.percentile),
      })),
    }));

    // Aliases são DERIVADOS dos genótipos canônicos deste painel, não lidos de
    // uma tabela.
    //
    // A primeira versão os persistia por SNP, e isso produziu um defeito real: o
    // BDNF rs6265 usa notação C/T no painel de performance e G/A no de
    // nutrigenética. Como a tabela era global por SNP, semear o segundo painel
    // sobrescrevia os aliases do primeiro, e um "CT" vindo do laboratório passava
    // a resolver para "GA" — que o painel de performance não reconhece. O
    // marcador saía do cálculo e o laudo era emitido sem ele.
    //
    // O conjunto de aliases é função pura dos genótipos canônicos do painel.
    // Derivar elimina a duplicação de estado que permitiu a divergência.
    const aliases: GenotypeAliasMap[] = panel.categories
      .flatMap((category) => category.snps)
      .map((panelSnp) =>
        GenotypeNormalizer.buildAliases(
          panelSnp.snp.rsId,
          panelSnp.genotypeScores.map((gs) => gs.genotype),
        ),
      );

    const definition: PanelDefinition = {
      slug: panel.slug,
      categories,
      modalities,
      aliases,
    };

    return {
      ref: {
        id: panel.id,
        slug: panel.slug,
        version: panel.version,
        name: panel.name,
        scoringModel: panel.scoringModel,
      },
      definition,
      categoryNames: new Map(panel.categories.map((c) => [c.slug, c.name])),
      modalityNames: new Map(panel.modalities.map((m) => [m.slug, m.name])),
    };
  }
}
