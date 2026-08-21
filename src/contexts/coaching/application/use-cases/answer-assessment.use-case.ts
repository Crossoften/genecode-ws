import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { ConflictError, type DomainError, ForbiddenError, NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { Checkpoint, resolveNextCheckpoint } from '../../domain/checkpoint';
import { scoreCategory, type WeightedQuestion } from '../../domain/environmental-score';

export interface QuestionnaireOption {
  readonly id: string;
  readonly label: string;
}

export interface QuestionnaireQuestion {
  readonly id: string;
  readonly text: string;
  readonly weight: number;
  readonly options: readonly QuestionnaireOption[];
  /** Opção escolhida numa avaliação anterior deste checkpoint, se houver. */
  readonly answeredOptionId: string | null;
}

export interface QuestionnaireCategory {
  readonly slug: string;
  readonly name: string;
  readonly geneticScore: number;
  readonly adjustedScore: number | null;
  readonly questions: readonly QuestionnaireQuestion[];
}

export interface Questionnaire {
  readonly subjectId: string;
  readonly subjectName: string;
  readonly panelSlug: string;
  readonly panelName: string;
  /** Próximo checkpoint a responder, ou null quando o ciclo terminou. */
  readonly checkpoint: Checkpoint | null;
  readonly unlocked: boolean;
  /** Data em que o próximo checkpoint libera, quando ainda travado. */
  readonly unlocksAt: Date | null;
  readonly completed: readonly Checkpoint[];
  readonly categories: readonly QuestionnaireCategory[];
}

export interface AnswerInput {
  readonly questionId: string;
  readonly optionId: string;
}

export interface AssessmentResult {
  readonly checkpoint: Checkpoint;
  readonly categories: readonly {
    readonly slug: string;
    readonly geneticScore: number;
    readonly adjustedScore: number;
  }[];
}

/**
 * Reads the environmental questionnaire and records the professional's answers.
 *
 * The professional interviews the patient and answers on their behalf; the
 * answers turn into an environmental score per genetic group, combined with the
 * genetic score to produce the adjusted score (see {@link scoreCategory}). The
 * three-month lock between checkpoints is enforced here, and access is checked
 * against the sharing authorisation — the guard only proves the person is a
 * professional, not that they may see *this* subject.
 *
 * Nothing here reads `subject_genotypes`: the questionnaire never exposes
 * genotype, only category scores.
 */
@Injectable()
export class AnswerAssessmentUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async getQuestionnaire(
    subjectId: string,
    professionalId: string,
    now: Date = new Date(),
  ): Promise<Result<Questionnaire>> {
    const authorized = await this.assertAuthorized(subjectId, professionalId);
    if (authorized) return fail(authorized);

    const context = await this.loadContext(subjectId);
    if (context.isFail()) return fail(context.error);
    const { panelSlug, panelName, geneticByCategory, categories } = context.value;

    const [questions, assessments, subject] = await Promise.all([
      this.prisma.environmentalQuestion.findMany({
        where: { panelSlug, active: true },
        orderBy: { order: 'asc' },
        include: { options: { orderBy: { order: 'asc' } } },
      }),
      this.prisma.assessment.findMany({ where: { subjectId }, orderBy: { completedAt: 'desc' } }),
      this.subjectName(subjectId),
    ]);

    const availability = resolveNextCheckpoint(
      assessments.map((a) => ({ checkpoint: a.checkpoint as Checkpoint, completedAt: a.completedAt })),
      now,
    );

    // Respostas do checkpoint corrente (se o profissional reabrir antes de fechar).
    const current = availability.next
      ? assessments.find((a) => a.checkpoint === availability.next)
      : undefined;
    const previousAnswers = (current?.answers as Record<string, string> | null) ?? {};
    const latestAdjusted = (assessments[0]?.adjustedScores ?? null) as Record<string, number> | null;

    const byCategory = new Map<string, typeof questions>();
    for (const question of questions) {
      const list = byCategory.get(question.categorySlug) ?? [];
      list.push(question);
      byCategory.set(question.categorySlug, list);
    }

    return ok({
      subjectId,
      subjectName: subject,
      panelSlug,
      panelName,
      checkpoint: availability.next,
      unlocked: availability.unlocked,
      unlocksAt: availability.unlocksAt,
      completed: assessments.map((a) => a.checkpoint as Checkpoint),
      categories: categories.map((category) => ({
        slug: category.slug,
        name: category.name,
        geneticScore: geneticByCategory.get(category.slug) ?? 0,
        adjustedScore: latestAdjusted?.[category.slug] ?? null,
        questions: (byCategory.get(category.slug) ?? []).map((question) => ({
          id: question.id,
          text: question.text,
          weight: question.weight,
          options: question.options.map((o) => ({ id: o.id, label: o.label })),
          answeredOptionId: previousAnswers[question.id] ?? null,
        })),
      })),
    });
  }

  async submit(
    subjectId: string,
    professionalId: string,
    checkpoint: Checkpoint,
    answers: readonly AnswerInput[],
    now: Date = new Date(),
  ): Promise<Result<AssessmentResult>> {
    const authorized = await this.assertAuthorized(subjectId, professionalId);
    if (authorized) return fail(authorized);

    const context = await this.loadContext(subjectId);
    if (context.isFail()) return fail(context.error);
    const { panelSlug, geneticByCategory } = context.value;

    const assessments = await this.prisma.assessment.findMany({
      where: { subjectId },
      select: { checkpoint: true, completedAt: true },
    });
    const availability = resolveNextCheckpoint(
      assessments.map((a) => ({ checkpoint: a.checkpoint as Checkpoint, completedAt: a.completedAt })),
      now,
    );

    // A trava de tempo é regra do laboratório: só o próximo checkpoint da
    // sequência, e só depois de liberado.
    if (availability.next !== checkpoint) {
      return fail(new ConflictError('Este não é o checkpoint disponível para esta pessoa.'));
    }
    if (!availability.unlocked) {
      return fail(
        new ConflictError(
          `Este checkpoint libera em ${availability.unlocksAt?.toISOString().slice(0, 10) ?? 'breve'}.`,
        ),
      );
    }

    const questions = await this.prisma.environmentalQuestion.findMany({
      where: { panelSlug, active: true },
      include: { options: { select: { id: true, points: true } } },
    });

    const answersByQuestion = new Map(answers.map((a) => [a.questionId, a.optionId]));

    const weighted: WeightedQuestion[] = questions.map((q) => ({
      id: q.id,
      categorySlug: q.categorySlug,
      weight: q.weight,
      optionPoints: new Map(q.options.map((o) => [o.id, o.points])),
    }));

    const environmentalScores: Record<string, number> = {};
    const adjustedScores: Record<string, number> = {};
    const resultCategories: {
      slug: string;
      geneticScore: number;
      adjustedScore: number;
    }[] = [];

    for (const [categorySlug, geneticScore] of geneticByCategory) {
      const categoryQuestions = weighted.filter((q) => q.categorySlug === categorySlug);
      const scored = scoreCategory(panelSlug, geneticScore, categoryQuestions, answersByQuestion);
      if (!scored) continue;
      environmentalScores[categorySlug] = scored.environmental;
      adjustedScores[categorySlug] = scored.adjusted;
      resultCategories.push({ slug: categorySlug, geneticScore, adjustedScore: scored.adjusted });
    }

    // O `answers` guardado é questionId → optionId, para reabrir a avaliação e
    // para auditoria de como cada escore foi obtido.
    const answersJson = Object.fromEntries(answersByQuestion);

    await this.prisma.assessment.upsert({
      where: { subjectId_checkpoint: { subjectId, checkpoint } },
      update: { professionalId, answers: answersJson, environmentalScores, adjustedScores },
      create: {
        subjectId,
        professionalId,
        checkpoint,
        answers: answersJson,
        environmentalScores,
        adjustedScores,
      },
    });

    return ok({ checkpoint, categories: resultCategories });
  }

  /** Autorização por titular, além do papel — como no laudo consolidado. */
  private async assertAuthorized(subjectId: string, professionalId: string): Promise<DomainError | null> {
    const sharing = await this.prisma.dataSharing.findUnique({
      where: { subjectId_professionalId: { subjectId, professionalId } },
    });
    if (!sharing || sharing.status !== 'AUTHORIZED') {
      return new ForbiddenError(
        'Você não tem autorização para avaliar esta pessoa, ou ela foi revogada.',
      );
    }
    return null;
  }

  private async loadContext(subjectId: string): Promise<
    Result<{
      panelSlug: string;
      panelName: string;
      geneticByCategory: Map<string, number>;
      categories: { slug: string; name: string }[];
    }>
  > {
    const report = await this.prisma.report.findFirst({
      where: { subjectId, status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      include: {
        panel: { select: { slug: true, name: true } },
        categoryScores: {
          include: { category: { select: { slug: true, name: true, position: true } } },
        },
      },
    });
    if (!report) return fail(new NotFoundError('Esta pessoa ainda não tem laudo disponível.'));

    const ordered = report.categoryScores.sort((a, b) => a.category.position - b.category.position);
    return ok({
      panelSlug: report.panel.slug,
      panelName: report.panel.name,
      geneticByCategory: new Map(ordered.map((e) => [e.category.slug, Number(e.normalizedScore)])),
      categories: ordered.map((e) => ({ slug: e.category.slug, name: e.category.name })),
    });
  }

  private async subjectName(subjectId: string): Promise<string> {
    const link = await this.prisma.subjectLink.findFirst({
      where: { subjectId },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { name: true } } },
    });
    return link?.user.name ?? '';
  }
}
