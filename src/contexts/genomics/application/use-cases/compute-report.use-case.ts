import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError, ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { PANEL_REPOSITORY, type PanelRepository } from '../../domain/ports/panel.repository';
import { ReportCalculator } from '../../domain/scoring/report-calculator';
import { ScoreBand } from '../../domain/scoring/score-band';

export interface ComputeReportInput {
  /** Código único do paciente — o mesmo impresso no kit. */
  readonly subjectCode: string;
  readonly panelId: string;
  readonly genotypes: ReadonlyMap<string, string>;
  readonly batchId?: string;
}

export interface ComputeReportOutput {
  readonly reportId: string;
  readonly subjectId: string;
  readonly version: number;
  readonly categoriesComputed: number;
  readonly modalitiesComputed: number;
  readonly missingMarkers: readonly string[];
}

/**
 * Computes and persists a report for one subject.
 *
 * Reports are never overwritten. Recomputing — because the laboratory resent a
 * sample, or because a new panel version was published — creates a new version
 * and marks the previous one `SUPERSEDED`. A report is a health document: what
 * the patient was told on a given date has to remain retrievable.
 */
@Injectable()
export class ComputeReportUseCase {
  constructor(
    @Inject(PANEL_REPOSITORY) private readonly panels: PanelRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: ComputeReportInput): Promise<Result<ComputeReportOutput>> {
    const panel = await this.panels.loadById(input.panelId);
    if (!panel) return fail(new NotFoundError('Painel não encontrado.'));

    const calculator = new ReportCalculator(panel.definition);
    const result = calculator.calculate(input.genotypes);

    // Genótipo ilegível é erro do arquivo, não resultado ruim: falha a linha
    // inteira para o laboratório corrigir, em vez de emitir um laudo parcial.
    if (result.rejectedMarkers.length > 0) {
      const detail = result.rejectedMarkers
        .map((marker) => `${marker.rsId}="${marker.rawValue}"`)
        .join('; ');
      return fail(new ValidationError(`Genótipos inválidos: ${detail}`));
    }

    // Genótipo fornecido que o painel não sabe pontuar é defeito de dado, não
    // exame incompleto. Emitir o laudo assim mesmo significaria entregar um
    // escore calculado com menos marcadores do que ele afirma ter.
    if (result.unmatchedMarkers.length > 0) {
      const detail = result.unmatchedMarkers
        .map((marker) => `${marker.rsId}="${marker.genotype}"`)
        .join('; ');
      return fail(
        new ValidationError(
          `Genótipos não reconhecidos pelo painel: ${detail}. ` +
            'Verifique se o arquivo corresponde ao painel selecionado.',
        ),
      );
    }

    if (result.categories.length === 0) {
      return fail(new ValidationError('Nenhum marcador do painel foi encontrado na linha.'));
    }

    const subjectId = await this.resolveSubject(input.subjectCode);

    const categoryIds = await this.mapSlugs('panelCategory', input.panelId);
    const modalityIds = await this.mapSlugs('modality', input.panelId);

    const report = await this.prisma.$transaction(async (tx) => {
      await tx.subjectGenotype.deleteMany({ where: { subjectId } });
      const snpIds = await tx.snp.findMany({
        where: { rsId: { in: [...input.genotypes.keys()] } },
        select: { id: true, rsId: true },
      });
      const snpIdByRs = new Map(snpIds.map((snp) => [snp.rsId, snp.id]));

      await tx.subjectGenotype.createMany({
        data: [...input.genotypes.entries()]
          .filter(([rsId]) => snpIdByRs.has(rsId))
          .map(([rsId, rawValue]) => ({
            subjectId,
            snpId: snpIdByRs.get(rsId)!,
            rawValue,
            genotype: rawValue.trim().toUpperCase(),
            batchId: input.batchId,
          })),
      });

      const previous = await tx.report.findFirst({
        where: { subjectId, panelId: input.panelId },
        orderBy: { version: 'desc' },
      });

      if (previous) {
        await tx.report.update({
          where: { id: previous.id },
          data: { status: 'SUPERSEDED' },
        });
      }

      return tx.report.create({
        data: {
          subjectId,
          panelId: input.panelId,
          version: (previous?.version ?? 0) + 1,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          missingMarkers:
            result.missingMarkers.length > 0 ? [...result.missingMarkers] : undefined,
          categoryScores: {
            create: result.categories
              .filter((category) => categoryIds.has(category.slug))
              .map((category) => ({
                categoryId: categoryIds.get(category.slug)!,
                rawScore: category.rawScore,
                normalizedScore: category.normalizedScore,
                band: category.band as ScoreBand,
              })),
          },
          modalityIndexes: {
            create: result.modalities
              .filter((modality) => modalityIds.has(modality.slug))
              .map((modality) => ({
                modalityId: modalityIds.get(modality.slug)!,
                rawIndex: modality.rawIndex,
                normalizedIndex: modality.normalizedIndex,
                band: modality.band as ScoreBand,
              })),
          },
        },
      });
    });

    return ok({
      reportId: report.id,
      subjectId,
      version: report.version,
      categoriesComputed: result.categories.length,
      modalitiesComputed: result.modalities.length,
      missingMarkers: result.missingMarkers,
    });
  }

  /**
   * Finds or creates the subject for a laboratory code.
   *
   * The code is the link between the physical kit and the genetic data. In this
   * wave the subject is created on the fly; once the kit context exists (Wave 3)
   * the code will already have been activated by the patient, and this becomes a
   * lookup that fails when it finds nothing — which is the safer behaviour, and
   * exactly the safeguard the client insisted on: a sample must never be
   * attributed to the wrong person.
   */
  private async resolveSubject(subjectCode: string): Promise<string> {
    const existing = await this.prisma.subject.findFirst({
      where: { externalCode: subjectCode },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await this.prisma.subject.create({
      data: { externalCode: subjectCode },
      select: { id: true },
    });
    return created.id;
  }

  /** Mapeia slug → id para categorias ou modalidades de um painel. */
  private async mapSlugs(
    entity: 'panelCategory' | 'modality',
    panelId: string,
  ): Promise<Map<string, string>> {
    const records =
      entity === 'panelCategory'
        ? await this.prisma.panelCategory.findMany({
            where: { panelId },
            select: { id: true, slug: true },
          })
        : await this.prisma.modality.findMany({
            where: { panelId },
            select: { id: true, slug: true },
          });

    return new Map(records.map((record) => [record.slug, record.id]));
  }
}
