import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@contexts/identity/presentation/decorators';

import { GetReportUseCase } from '../../application/use-cases/get-report.use-case';
import { IngestGenotypesUseCase } from '../../application/use-cases/ingest-genotypes.use-case';
import { IngestCsvDto } from '../dtos/ingest-csv.dto';

@ApiTags('Laudos')
@Controller()
export class ReportsController {
  constructor(
    private readonly ingest: IngestGenotypesUseCase,
    private readonly getReport: GetReportUseCase,
  ) {}

  /**
   * Ingests a laboratory CSV and produces one report per row.
   *
   * Restricted to `lab.upload`: this is the entry point of every genetic result
   * in the platform, and the client's model has the laboratory uploading it
   * manually from the admin area.
   */
  @Post('lab/genotypes/import')
  @RequirePermissions('lab.upload')
  @ApiOperation({ summary: 'Importa CSV de genótipos e calcula os laudos' })
  async importCsv(@Body() dto: IngestCsvDto) {
    const result = await this.ingest.execute({
      filename: dto.filename,
      csvContent: dto.content,
      panelSlug: dto.panelSlug,
    });
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Level 1 of the report: global index, categories and modality indexes. */
  @Get('reports/:id')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Resumo do laudo' })
  async summary(@Param('id') id: string) {
    const result = await this.getReport.summary(id);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Level 2: the markers of one biological category, with the subject's genotype. */
  @Get('reports/:id/categorias/:slug')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Detalhe de uma categoria biológica' })
  async category(@Param('id') id: string, @Param('slug') slug: string) {
    const result = await this.getReport.category(id, slug);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Level 3: one marker in full, including scientific references. */
  @Get('reports/:id/marcadores/:rsId')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Detalhe de um marcador, com referências científicas' })
  async marker(@Param('id') id: string, @Param('rsId') rsId: string) {
    const result = await this.getReport.marker(id, rsId);
    if (result.isFail()) throw result.error;
    return result.value;
  }
}
