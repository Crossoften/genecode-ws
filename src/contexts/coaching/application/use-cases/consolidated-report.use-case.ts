import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { ForbiddenError, NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

export interface ConsolidatedCategory {
  readonly slug: string;
  readonly name: string;
  readonly geneticScore: number;
  readonly band: string;
  /** Presente só quando houve entrevista. Null significa "ainda não avaliado". */
  readonly adjustedScore: number | null;
}

export interface ConsolidatedReport {
  readonly subjectId: string;
  readonly panelName: string;
  readonly globalIndex: number | null;
  readonly categories: readonly ConsolidatedCategory[];
  readonly assessmentsCompleted: number;
  /** Avisa que o ajustado ainda usa a fórmula preliminar. */
  readonly adjustedIsPreliminary: boolean;
}

/**
 * Laudo consolidado, para o profissional autorizado.
 *
 * ### O que este caso de uso deliberadamente NÃO devolve
 *
 * Augusto foi categórico em 22/06:
 *
 * > *"A gente não pode mostrar, por exemplo, genótipo. Tem algumas informações
 * > sensíveis que a gente não quer que esse profissional veja. É o resumão do
 * > negócio. Não vai ter todos os detalhes que o mesmo laudo do paciente. O do
 * > paciente é muito completo. É um laudo full."*
 *
 * Então não saem daqui: **genótipo**, texto interpretativo por marcador, ação da
 * proteína, referências, e — como em todo lugar — a contribuição de cada
 * marcador para o escore.
 *
 * A garantia é estrutural, não uma lista de campos a omitir: a consulta nem
 * chega perto de `subject_genotypes`. Não há como um genótipo escapar por
 * descuido de DTO porque ele nunca é carregado.
 *
 * ### Sobre "ver como paciente"
 *
 * O usuário pediu que o profissional pudesse ver a tela como o paciente vê.
 * Isso contraria diretamente a regra acima, então não foi implementado — está
 * registrado no item L7 das decisões, com a sugestão de virar uma autorização
 * separada e explícita do titular, e não um espelho da tela.
 */
@Injectable()
export class ConsolidatedReportUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param subjectId - Titular do dado genético.
   * @param professionalId - Perfil profissional que está consultando.
   */
  async execute(
    subjectId: string,
    professionalId: string,
  ): Promise<Result<ConsolidatedReport>> {
    const sharing = await this.prisma.dataSharing.findUnique({
      where: { subjectId_professionalId: { subjectId, professionalId } },
    });

    // Autorização checada aqui, e não só no guard: o guard sabe que a pessoa é
    // um profissional, não que ela pode ver *este* titular.
    if (!sharing || sharing.status !== 'AUTHORIZED') {
      return fail(
        new ForbiddenError(
          'Você não tem autorização para acessar os dados desta pessoa, ou ela foi revogada.',
        ),
      );
    }

    const report = await this.prisma.report.findFirst({
      where: { subjectId, status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      include: {
        panel: { select: { name: true } },
        categoryScores: {
          include: { category: { select: { slug: true, name: true, position: true } } },
        },
        modalityIndexes: {
          where: { modality: { isGlobal: true } },
          include: { modality: { select: { isGlobal: true } } },
        },
      },
    });

    if (!report) return fail(new NotFoundError('Esta pessoa ainda não tem laudo disponível.'));

    const assessments = await this.prisma.assessment.findMany({
      where: { subjectId },
      orderBy: { completedAt: 'desc' },
    });

    const latest = assessments[0];
    const adjusted = (latest?.adjustedScores ?? null) as Record<string, number> | null;

    const global = report.modalityIndexes[0];

    return ok({
      subjectId,
      panelName: report.panel.name,
      globalIndex: global ? Number(global.normalizedIndex) : null,
      categories: report.categoryScores
        .sort((a, b) => a.category.position - b.category.position)
        .map((entry) => ({
          slug: entry.category.slug,
          name: entry.category.name,
          geneticScore: Number(entry.normalizedScore),
          band: entry.band,
          // Null quando não houve entrevista. O card do ajustado some na tela,
          // em vez de repetir o genético — foi o que o cliente aprovou em 16/07:
          // sem entrevista, não existe ajustado.
          adjustedScore: adjusted?.[entry.category.slug] ?? null,
        })),
      assessmentsCompleted: assessments.length,
      // O ajustado agora vem do questionário ambiental respondido pelo
      // profissional, combinado ao genético pela estratégia validada do painel.
      // Deixa de ser preliminar assim que existe uma avaliação de verdade.
      adjustedIsPreliminary: latest === undefined,
    });
  }
}
