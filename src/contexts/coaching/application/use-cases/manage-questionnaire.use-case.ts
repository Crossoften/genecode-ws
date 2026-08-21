import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { type DomainError, NotFoundError, ValidationError } from '@shared/domain/domain-error';
import { fail, ok, okVoid, type Result } from '@shared/domain/result';

export interface QuestionOptionInput {
  readonly label: string;
  /** Qualidade do hábito nesta resposta: 0 (pior) a 100 (melhor). */
  readonly points: number;
}

export interface QuestionInput {
  readonly panelSlug: string;
  readonly categorySlug: string;
  readonly text: string;
  readonly weight: number;
  readonly options: readonly QuestionOptionInput[];
}

export interface QuestionView {
  readonly id: string;
  readonly panelSlug: string;
  readonly categorySlug: string;
  readonly text: string;
  readonly weight: number;
  readonly order: number;
  readonly active: boolean;
  readonly options: readonly { readonly id: string; readonly label: string; readonly points: number; readonly order: number }[];
}

/**
 * Authoring of the environmental questionnaire.
 *
 * Questions live in data, not code: the laboratory adds, removes and re-weighs
 * them from the admin without a deploy (decision B5). Each question is tagged to
 * the genetic group it measures and carries a weight inside that group; the
 * scoring math (additive vs multiplicative) does not change because of them.
 */
@Injectable()
export class ManageQuestionnaireUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async list(panelSlug?: string): Promise<QuestionView[]> {
    const questions = await this.prisma.environmentalQuestion.findMany({
      where: panelSlug ? { panelSlug } : {},
      orderBy: [{ panelSlug: 'asc' }, { categorySlug: 'asc' }, { order: 'asc' }],
      include: { options: { orderBy: { order: 'asc' } } },
    });
    return questions.map(toView);
  }

  async create(input: QuestionInput): Promise<Result<QuestionView>> {
    const invalid = validate(input);
    if (invalid) return fail(invalid);

    const max = await this.prisma.environmentalQuestion.aggregate({
      where: { panelSlug: input.panelSlug, categorySlug: input.categorySlug },
      _max: { order: true },
    });

    const created = await this.prisma.environmentalQuestion.create({
      data: {
        panelSlug: input.panelSlug,
        categorySlug: input.categorySlug,
        text: input.text.trim(),
        weight: input.weight,
        order: (max._max.order ?? 0) + 1,
        options: {
          create: input.options.map((option, index) => ({
            label: option.label.trim(),
            points: option.points,
            order: index,
          })),
        },
      },
      include: { options: { orderBy: { order: 'asc' } } },
    });
    return ok(toView(created));
  }

  async update(id: string, input: QuestionInput): Promise<Result<QuestionView>> {
    const invalid = validate(input);
    if (invalid) return fail(invalid);

    const exists = await this.prisma.environmentalQuestion.findUnique({ where: { id } });
    if (!exists) return fail(new NotFoundError('Pergunta não encontrada.'));

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.environmentalOption.deleteMany({ where: { questionId: id } });
      return tx.environmentalQuestion.update({
        where: { id },
        data: {
          categorySlug: input.categorySlug,
          text: input.text.trim(),
          weight: input.weight,
          options: {
            create: input.options.map((option, index) => ({
              label: option.label.trim(),
              points: option.points,
              order: index,
            })),
          },
        },
        include: { options: { orderBy: { order: 'asc' } } },
      });
    });
    return ok(toView(updated));
  }

  async setActive(id: string, active: boolean): Promise<Result<void>> {
    const exists = await this.prisma.environmentalQuestion.findUnique({ where: { id } });
    if (!exists) return fail(new NotFoundError('Pergunta não encontrada.'));
    await this.prisma.environmentalQuestion.update({ where: { id }, data: { active } });
    return okVoid();
  }
}

function validate(input: QuestionInput): DomainError | null {
  if (input.options.length < 2) {
    return new ValidationError('Uma pergunta precisa de pelo menos duas opções.');
  }
  return null;
}

function toView(q: {
  id: string;
  panelSlug: string;
  categorySlug: string;
  text: string;
  weight: number;
  order: number;
  active: boolean;
  options: { id: string; label: string; points: number; order: number }[];
}): QuestionView {
  return {
    id: q.id,
    panelSlug: q.panelSlug,
    categorySlug: q.categorySlug,
    text: q.text,
    weight: q.weight,
    order: q.order,
    active: q.active,
    options: q.options.map((o) => ({ id: o.id, label: o.label, points: o.points, order: o.order })),
  };
}
