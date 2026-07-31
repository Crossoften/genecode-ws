import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { PANEL_REPOSITORY, type PanelRepository } from '../../domain/ports/panel.repository';
import { ComputeReportUseCase } from './compute-report.use-case';

export interface IngestGenotypesInput {
  readonly filename: string;
  readonly csvContent: string;
  readonly panelSlug: string;
  readonly uploadedById?: string;
}

export interface RowFailure {
  readonly line: number;
  readonly subjectCode: string;
  readonly reason: string;
}

export interface IngestGenotypesOutput {
  readonly batchId: string;
  readonly totalRows: number;
  readonly processed: number;
  readonly failed: number;
  readonly failures: readonly RowFailure[];
}

/**
 * Ingests a laboratory CSV of raw genotypes and produces one report per row.
 *
 * The format was agreed with the client on 16/07: first column is the subject's
 * unique code, remaining columns are one genotype per marker, one row per
 * patient. The laboratory exports it from the genotyping equipment and uploads
 * it in the admin area — *"vocês encaminham, faz o upload e pronto, a aplicação
 * faz todo o resto sozinho"*.
 *
 * Every row is processed independently: a malformed row is recorded as a failure
 * and the rest of the batch continues. Rejecting a 200-patient file because one
 * cell is wrong would be unusable in practice, and the per-row report is what
 * lets the laboratory fix and resend just that line.
 */
@Injectable()
export class IngestGenotypesUseCase {
  private readonly logger = new Logger(IngestGenotypesUseCase.name);

  constructor(
    @Inject(PANEL_REPOSITORY) private readonly panels: PanelRepository,
    private readonly prisma: PrismaService,
    private readonly computeReport: ComputeReportUseCase,
  ) {}

  /**
   * @param input - The uploaded file and the panel to score it against.
   * @returns Counters and the per-row failures, or a validation failure when the
   *   file itself is unusable.
   */
  async execute(input: IngestGenotypesInput): Promise<Result<IngestGenotypesOutput>> {
    const panel = await this.panels.loadPublished(input.panelSlug);
    if (!panel) {
      return fail(new ValidationError(`Painel "${input.panelSlug}" não encontrado ou não publicado.`));
    }

    const parsed = parseCsv(input.csvContent);
    if (parsed.isFail()) return fail(parsed.error);

    const { header, rows } = parsed.value;

    const batch = await this.prisma.genotypeBatch.create({
      data: {
        filename: input.filename,
        uploadedById: input.uploadedById,
        status: 'PROCESSING',
        rowCount: rows.length,
      },
    });

    const failures: RowFailure[] = [];
    let processed = 0;

    for (const [index, row] of rows.entries()) {
      // +2: cabeçalho ocupa a linha 1 e o usuário conta a partir de 1.
      const line = index + 2;
      const subjectCode = row[0]?.trim() ?? '';

      if (subjectCode.length === 0) {
        failures.push({ line, subjectCode: '', reason: 'Código do paciente ausente.' });
        continue;
      }

      const genotypes = new Map<string, string>();
      for (let column = 1; column < header.length; column += 1) {
        const marker = header[column];
        const value = row[column];
        if (marker && value && value.trim().length > 0) {
          genotypes.set(marker, value.trim());
        }
      }

      const result = await this.computeReport.execute({
        subjectCode,
        panelId: panel.ref.id,
        genotypes,
        batchId: batch.id,
      });

      if (result.isFail()) {
        failures.push({ line, subjectCode, reason: result.error.message });
        continue;
      }
      processed += 1;
    }

    await this.prisma.genotypeBatch.update({
      where: { id: batch.id },
      data: {
        status: failures.length === rows.length ? 'FAILED' : 'COMPLETED',
        processedCount: processed,
        failedCount: failures.length,
        errors: failures.length > 0 ? JSON.parse(JSON.stringify(failures)) : undefined,
        completedAt: new Date(),
      },
    });

    this.logger.log(
      `Lote ${batch.id}: ${processed}/${rows.length} processados, ${failures.length} falhas`,
    );

    return ok({
      batchId: batch.id,
      totalRows: rows.length,
      processed,
      failed: failures.length,
      failures,
    });
  }
}

interface ParsedCsv {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Parses the laboratory CSV.
 *
 * Intentionally minimal rather than pulling in a CSV library: the format is
 * fully controlled — no quoting, no embedded separators, plain genotype codes.
 * Adding a dependency here would buy nothing and widen the supply chain of a
 * system that handles genetic data.
 *
 * Handles the two things that do vary in practice: the UTF-8 BOM that Excel
 * prepends, and CRLF line endings from Windows.
 */
function parseCsv(content: string): Result<ParsedCsv> {
  const normalised = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = normalised.split('\n').filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return fail(new ValidationError('Arquivo vazio ou sem linhas de dados.'));
  }

  const separator = detectSeparator(lines[0]!);
  const header = lines[0]!.split(separator).map((cell) => normaliseHeader(cell));

  if (header.length < 2) {
    return fail(
      new ValidationError(
        'Cabeçalho inválido: esperado o código do paciente seguido de uma coluna por marcador.',
      ),
    );
  }

  const rows = lines.slice(1).map((line) => line.split(separator));
  return ok({ header, rows });
}

/** Excel em português exporta com ponto e vírgula; o padrão internacional é vírgula. */
function detectSeparator(headerLine: string): string {
  return headerLine.split(';').length > headerLine.split(',').length ? ';' : ',';
}

/**
 * Extracts the rsID from a column name.
 *
 * The laboratory writes columns as `ACTN3_rs1815739`, and the same marker has
 * appeared as `TNF_rs1800629` in one source and `TNF-alfa_rs1800629` in another.
 * Keying on the rsID makes the gene label irrelevant to the join.
 */
function normaliseHeader(cell: string): string {
  const trimmed = cell.trim();
  const match = /(rs\d+)/i.exec(trimmed);
  return match ? match[1]!.toLowerCase() : trimmed;
}
