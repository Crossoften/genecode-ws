import { Injectable } from '@nestjs/common';

import {
  GetReportUseCase,
  type CategoryDetail,
  type MarkerFullDetail,
  type ReportSummary,
  type ReportViewer,
} from '@contexts/genomics/application/use-cases/get-report.use-case';
import { PrismaService } from '@infra/database/prisma.service';
import { ForbiddenError, NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

/**
 * Mensagem de quem perdeu o acesso. A tela do treinador mostra esta frase, então
 * ela fala do compartilhamento, não do laudo: o laudo continua existindo.
 */
export const SHARING_ENDED_MESSAGE =
  'O acesso a este laudo foi encerrado: o compartilhamento não está mais ativo.';

/**
 * Laudo espelho do treinador (GC-N05-15).
 *
 * Reunião de 05/11, literal: *"o treinador precisa ter um espelho exato, copy
 * paste do que o paciente vê, da mesma forma dinâmico, com aquelas frases"* e
 * *"o laudo interativo que tem que ir full pro treinador"*, inclusive o PDF.
 * Isso revê a regra de 22/06 ("é o resumão do negócio"), que segue registrada
 * no `ConsolidatedReportUseCase` — o consolidado continua servindo de prévia.
 *
 * Este caso de uso **não monta laudo nenhum**: resolve qual é o laudo vigente do
 * titular e devolve o que o `GetReportUseCase` devolve ao próprio titular. É o
 * que garante o "espelho exato" — um DTO só, nunca dois que divergem com o
 * tempo.
 *
 * A autorização é checada duas vezes, de propósito:
 *
 * 1. aqui, para responder 403 com uma frase que a tela possa mostrar ("o acesso
 *    foi encerrado") em vez de um 404 genérico;
 * 2. dentro do `GetReportUseCase`, que é a barreira única do laudo — qualquer
 *    caminho que chegue a ele passa pela mesma regra.
 *
 * O front nunca decide: sem `DataSharing` `AUTHORIZED` entre este titular e
 * este perfil profissional, nada sai daqui.
 */
@Injectable()
export class SharedReportUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: GetReportUseCase,
  ) {}

  /** Nível 1: o mesmo resumo que o titular abre. Entra na trilha de auditoria. */
  async summary(subjectId: string, viewer: ReportViewer): Promise<Result<ReportSummary>> {
    const access = await this.resolve(subjectId, viewer);
    if (access.isFail()) return fail(access.error);

    const result = await this.reports.summary(access.value.reportId, viewer);
    if (result.isOk()) {
      // Acesso a dado genético sempre entra na trilha — e agora o treinador vê
      // genótipo. Só o nível 1: é a abertura do laudo; os cliques no acordeão
      // não viram uma linha cada.
      await this.prisma.auditLog.create({
        data: {
          userId: viewer.id,
          action: 'sharing.report_viewed',
          resource: 'data_sharing',
          resourceId: access.value.sharingId,
        },
      });
    }
    return result;
  }

  /** Nível 2: os marcadores de uma categoria, com o genótipo — como o titular vê. */
  async category(
    subjectId: string,
    slug: string,
    viewer: ReportViewer,
  ): Promise<Result<CategoryDetail>> {
    const access = await this.resolve(subjectId, viewer);
    if (access.isFail()) return fail(access.error);
    return this.reports.category(access.value.reportId, slug, viewer);
  }

  /** Nível 3: um marcador completo. */
  async marker(
    subjectId: string,
    rsId: string,
    viewer: ReportViewer,
  ): Promise<Result<MarkerFullDetail>> {
    const access = await this.resolve(subjectId, viewer);
    if (access.isFail()) return fail(access.error);
    return this.reports.marker(access.value.reportId, rsId, viewer);
  }

  /**
   * Compartilhamento ativo + laudo vigente do titular.
   *
   * Laudo vigente é o último `PUBLISHED`, o mesmo critério do consolidado e da
   * área do paciente: rascunho esperando conferência não é documento.
   */
  private async resolve(
    subjectId: string,
    viewer: ReportViewer,
  ): Promise<Result<{ reportId: string; sharingId: string }>> {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId: viewer.id },
      select: { id: true },
    });
    if (!profile) return fail(new NotFoundError('Perfil profissional não encontrado.'));

    const sharing = await this.prisma.dataSharing.findUnique({
      where: { subjectId_professionalId: { subjectId, professionalId: profile.id } },
      select: { id: true, status: true },
    });
    if (!sharing || sharing.status !== 'AUTHORIZED') {
      return fail(new ForbiddenError(SHARING_ENDED_MESSAGE));
    }

    const report = await this.prisma.report.findFirst({
      where: { subjectId, status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      select: { id: true },
    });
    if (!report) return fail(new NotFoundError('Esta pessoa ainda não tem laudo disponível.'));

    return ok({ reportId: report.id, sharingId: sharing.id });
  }
}
