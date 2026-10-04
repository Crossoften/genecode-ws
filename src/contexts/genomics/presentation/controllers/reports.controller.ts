import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermissions } from '@contexts/identity/presentation/decorators';
import type { AuthenticatedPrincipal } from '@contexts/identity/presentation/guards/jwt-auth.guard';

import { GetReportUseCase } from '../../application/use-cases/get-report.use-case';
import { LiberarLaudoUseCase } from '../../application/use-cases/liberar-laudo.use-case';
import { IngestGenotypesUseCase } from '../../application/use-cases/ingest-genotypes.use-case';
import { LabHistoryUseCase } from '../../application/use-cases/lab-history.use-case';
import { LabSamplesUseCase } from '../../application/use-cases/lab-samples.use-case';
import { PatientAreaUseCase } from '../../application/use-cases/patient-area.use-case';
import { IngestCsvDto } from '../dtos/ingest-csv.dto';

@ApiTags('Laudos')
@Controller()
export class ReportsController {
  constructor(
    private readonly ingest: IngestGenotypesUseCase,
    private readonly liberarLaudo: LiberarLaudoUseCase,
    private readonly labSamples: LabSamplesUseCase,
    private readonly labHistory: LabHistoryUseCase,
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
   * Laudos já publicados, para o laboratório conferir o que saiu do CSV.
   *
   * Mesma permissão da fila: é o mesmo operador, na mesma tela, terminando o
   * mesmo trabalho. Abrir um laudo daqui cai em `GET /reports/:id`, que já
   * aceita o papel `lab`.
   */
  @Get('lab/historico')
  @RequirePermissions('samples.read')
  @ApiOperation({ summary: 'Laudos publicados, por pedido e kit' })
  async labHistoryList() {
    return this.labHistory.execute();
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
  // ── Conferência humana antes de o laudo chegar ao titular ────────────────
  //
  // Decisão do Camara em 02/10: "deve haver uma conferência humana responsável
  // por disparar o aviso ao cliente". Até lá, a importação do CSV publicava o
  // laudo e avisava o titular na mesma hora.

  /** Laudos calculados que ainda aguardam conferência. */
  //
  // `reports.publish`, e não `reports.read`: a leitura é do PACIENTE (o escopo
  // de qual laudo vem do SubjectLink), então usá-la aqui deixaria qualquer
  // titular listar os laudos de todo mundo. `reports.publish` é de admin e
  // master — o laboratório não a tem, e é de propósito: quem confere não é
  // quem produziu.
  @Get('admin/laudos/aguardando')
  @RequirePermissions('reports.publish')
  @ApiOperation({ summary: 'Laudos calculados aguardando conferência humana' })
  async laudosAguardando() {
    return this.liberarLaudo.aguardando();
  }

  /** Libera o laudo: publica, aposenta a versão anterior e avisa o cliente. */
  @Post('admin/laudos/:id/liberar')
  @RequirePermissions('reports.publish')
  @ApiOperation({ summary: 'Confere e libera o laudo para o titular' })
  async liberar(@Param('id') id: string, @CurrentUser() admin: AuthenticatedPrincipal) {
    const result = await this.liberarLaudo.liberar(id, admin.id);
    if (result.isFail()) throw result.error;
    return result.value;
  }

}
