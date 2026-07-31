import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

export interface ReportSummary {
  readonly id: string;
  readonly panel: { readonly name: string; readonly version: string };
  readonly publishedAt: Date | null;
  readonly globalIndex: { readonly value: number; readonly band: string } | null;
  readonly categories: readonly {
    readonly slug: string;
    readonly name: string;
    readonly score: number;
    readonly band: string;
  }[];
  readonly modalities: readonly {
    readonly slug: string;
    readonly name: string;
    readonly index: number;
    readonly band: string;
  }[];
  /** Marcadores que o CSV não trouxe. Vira aviso no laudo. */
  readonly missingMarkers: readonly string[];
}

export interface CategoryDetail {
  readonly slug: string;
  readonly name: string;
  readonly score: number;
  readonly band: string;
  readonly markers: readonly MarkerDetail[];
}

export interface MarkerDetail {
  readonly rsId: string;
  readonly gene: string;
  readonly genotype: string;
  readonly classification: string;
  /** Resumo clínico curto. Ausente quando o texto está em revisão. */
  readonly summary: string | null;
  /** Frequência do genótipo na população. */
  readonly genotypeFreq: number | null;
  readonly underReview: boolean;
}

export interface MarkerFullDetail extends MarkerDetail {
  /** Ação da proteína: igual para os 3 genótipos do gene. */
  readonly proteinAction: string | null;
  /** Texto voltado ao paciente, específico do genótipo dele. */
  readonly patientText: string | null;
  readonly references: string | null;
}

/**
 * Reads a report at the three levels of depth the client specified.
 *
 * Augusto described the product in 01/06: *"o laudo vai parecer um sitezinho.
 * Você clica lá, 'eu quero ver o snip de lesão', clico ali, ele já abre"* — the
 * opposite of a 30-page PDF the reader has to scroll through.
 *
 * ### Two confidentiality rules enforced here
 *
 * Both were stated by the client and are non-negotiable, and both are enforced
 * when building the DTO — hiding them in the frontend would not be hiding them:
 *
 * 1. **Nobody sees how much each marker contributed to the score.** Not even the
 *    patient. Dr. Câmara called it *"o pulo do gato"* — it is the laboratory's
 *    methodology. So `weight`, the per-marker score and the raw score never
 *    leave this layer.
 * 2. **The professional sees a consolidated view, never the genotype.** That is
 *    a separate query and lands with the professional area.
 */
@Injectable()
export class GetReportUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /** Level 1: cover of the report — global index, categories and modalities. */
  async summary(reportId: string): Promise<Result<ReportSummary>> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: {
        panel: { select: { name: true, version: true } },
        categoryScores: {
          include: { category: { select: { slug: true, name: true, position: true } } },
        },
        modalityIndexes: {
          include: { modality: { select: { slug: true, name: true, isGlobal: true, position: true } } },
        },
      },
    });

    if (!report) return fail(new NotFoundError('Laudo não encontrado.'));

    const global = report.modalityIndexes.find((entry) => entry.modality.isGlobal);

    return ok({
      id: report.id,
      panel: report.panel,
      publishedAt: report.publishedAt,
      globalIndex: global
        ? { value: Number(global.normalizedIndex), band: global.band }
        : null,
      categories: report.categoryScores
        .sort((a, b) => a.category.position - b.category.position)
        .map((entry) => ({
          slug: entry.category.slug,
          name: entry.category.name,
          score: Number(entry.normalizedScore),
          band: entry.band,
        })),
      modalities: report.modalityIndexes
        .filter((entry) => !entry.modality.isGlobal)
        .sort((a, b) => a.modality.position - b.modality.position)
        .map((entry) => ({
          slug: entry.modality.slug,
          name: entry.modality.name,
          index: Number(entry.normalizedIndex),
          band: entry.band,
        })),
      missingMarkers: (report.missingMarkers as string[] | null) ?? [],
    });
  }

  /** Level 2: the markers of one category, with the subject's genotype. */
  async category(reportId: string, categorySlug: string): Promise<Result<CategoryDetail>> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, subjectId: true, panelId: true },
    });
    if (!report) return fail(new NotFoundError('Laudo não encontrado.'));

    const score = await this.prisma.reportCategoryScore.findFirst({
      where: { reportId, category: { slug: categorySlug } },
      include: {
        category: {
          include: {
            snps: {
              orderBy: { position: 'asc' },
              include: { snp: true, genotypeScores: true },
            },
          },
        },
      },
    });
    if (!score) return fail(new NotFoundError('Categoria não encontrada neste laudo.'));

    const genotypes = await this.subjectGenotypes(report.subjectId);
    const interpretations = await this.interpretationsFor(report.panelId);

    const markers: MarkerDetail[] = score.category.snps.map((panelSnp) => {
      const genotype = genotypes.get(panelSnp.snp.rsId) ?? '—';
      const scored = panelSnp.genotypeScores.find((gs) => gs.genotype === genotype);
      const interpretation = interpretations.get(`${panelSnp.snp.rsId}|${genotype}`);
      const underReview = interpretation?.reviewRequired ?? false;

      return {
        rsId: panelSnp.snp.rsId,
        gene: panelSnp.snp.gene,
        genotype,
        classification: scored?.classification ?? 'INDISPONIVEL',
        // Texto em revisão é omitido: melhor não dizer nada do que dizer ao
        // paciente o oposto do que o escore dele indica.
        summary: underReview ? null : (interpretation?.summary ?? null),
        genotypeFreq: interpretation?.genotypeFreq ? Number(interpretation.genotypeFreq) : null,
        underReview,
      };
    });

    return ok({
      slug: score.category.slug,
      name: score.category.name,
      score: Number(score.normalizedScore),
      band: score.band,
      markers,
    });
  }

  /** Level 3: one marker in full — protein action, genotype text and references. */
  async marker(reportId: string, rsId: string): Promise<Result<MarkerFullDetail>> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { subjectId: true, panelId: true },
    });
    if (!report) return fail(new NotFoundError('Laudo não encontrado.'));

    const panelSnp = await this.prisma.panelSnp.findFirst({
      where: { panelId: report.panelId, snp: { rsId } },
      include: { snp: true, genotypeScores: true },
    });
    if (!panelSnp) return fail(new NotFoundError('Marcador não encontrado neste painel.'));

    const genotypes = await this.subjectGenotypes(report.subjectId);
    const genotype = genotypes.get(rsId) ?? '—';

    const interpretation = await this.prisma.interpretation.findUnique({
      where: { panelId_rsId_genotype: { panelId: report.panelId, rsId, genotype } },
    });

    const scored = panelSnp.genotypeScores.find((gs) => gs.genotype === genotype);
    const underReview = interpretation?.reviewRequired ?? false;

    return ok({
      rsId,
      gene: panelSnp.snp.gene,
      genotype,
      classification: scored?.classification ?? 'INDISPONIVEL',
      summary: underReview ? null : (interpretation?.summary ?? null),
      genotypeFreq: interpretation?.genotypeFreq ? Number(interpretation.genotypeFreq) : null,
      underReview,
      proteinAction: panelSnp.snp.proteinAction,
      patientText: underReview ? null : (interpretation?.patientText ?? null),
      references: interpretation?.references ?? null,
    });
  }

  /** rsId → genótipo canônico observado para o titular. */
  private async subjectGenotypes(subjectId: string): Promise<Map<string, string>> {
    const records = await this.prisma.subjectGenotype.findMany({
      where: { subjectId },
      include: { snp: { select: { rsId: true } } },
    });
    return new Map(records.map((record) => [record.snp.rsId, record.genotype]));
  }

  /** `rsId|genótipo` → interpretação, para evitar N+1 no nível 2. */
  private async interpretationsFor(panelId: string) {
    const records = await this.prisma.interpretation.findMany({
      where: { panelId },
      select: {
        rsId: true,
        genotype: true,
        summary: true,
        genotypeFreq: true,
        reviewRequired: true,
      },
    });
    return new Map(records.map((record) => [`${record.rsId}|${record.genotype}`, record]));
  }
}
