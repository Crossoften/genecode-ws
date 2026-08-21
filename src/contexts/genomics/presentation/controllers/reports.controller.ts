import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermissions } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';

import { GetReportUseCase } from '../../application/use-cases/get-report.use-case';
import { IngestGenotypesUseCase } from '../../application/use-cases/ingest-genotypes.use-case';
import { LabSamplesUseCase } from '../../application/use-cases/lab-samples.use-case';
import { PatientAreaUseCase } from '../../application/use-cases/patient-area.use-case';
import { IngestCsvDto } from '../dtos/ingest-csv.dto';

@ApiTags('Laudos')
@Controller()
export class ReportsController {
  constructor(
    private readonly ingest: IngestGenotypesUseCase,
    private readonly labSamples: LabSamplesUseCase,
    private readonly patientArea: PatientAreaUseCase,
    private readonly getReport: GetReportUseCase,
  ) {}

  /** Fila de amostras do laboratório: SAMPLE_RECEIVED e PROCESSING. */
  @Get('lab/amostras')
  @RequirePermissions('samples.read')
  @ApiOperation({ summary: 'Amostras aguardando o CSV de genótipos' })
  async labSamplesQueue() {
    return this.labSamples.execute();
  }

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

  /**
   * Resumo da área do paciente: kits, laudos e pedidos da conta logada.
   *
   * É a tela inicial de quem está logado. Sem ela, quem acabou de verificar o
   * e-mail cairia numa página sem nada.
   */
  @Get('area/resumo')
  @ApiOperation({ summary: 'Kits, laudos e pedidos da conta logada' })
  async area(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.patientArea.execute(user.id);
  }

  /** Level 1 of the report: global index, categories and modality indexes. */
  @Get('reports/:id')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Resumo do laudo' })
  async summary(@Param('id') id: string, @CurrentUser() user: AuthenticatedPrincipal) {
    const result = await this.getReport.summary(id, user);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Level 2: the markers of one biological category, with the subject's genotype. */
  @Get('reports/:id/categorias/:slug')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Detalhe de uma categoria biológica' })
  async category(
    @Param('id') id: string,
    @Param('slug') slug: string,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    const result = await this.getReport.category(id, slug, user);
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Level 3: one marker in full, including scientific references. */
  @Get('reports/:id/marcadores/:rsId')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Detalhe de um marcador, com referências científicas' })
  async marker(
    @Param('id') id: string,
    @Param('rsId') rsId: string,
    @CurrentUser() user: AuthenticatedPrincipal,
  ) {
    const result = await this.getReport.marker(id, rsId, user);
    if (result.isFail()) throw result.error;
    return result.value;
  }
}
