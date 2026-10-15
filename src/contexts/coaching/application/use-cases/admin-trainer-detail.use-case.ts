import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { ManageSharingUseCase, type ProfessionalPatient } from './manage-sharing.use-case';

export interface AdminTrainerDetail {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly specialty: string;
  readonly councilId: string | null;
  readonly bio: string | null;
  readonly status: string;
  readonly approvedAt: Date | null;
  readonly createdAt: Date;
  /** Alunos que compartilharam o laudo (inclui revogados, com o rótulo). */
  readonly students: readonly ProfessionalPatient[];
  /** Avaliações ambientais registradas por este treinador. */
  readonly assessments: readonly AdminTrainerAssessment[];
}

export interface AdminTrainerAssessment {
  readonly subjectName: string;
  readonly checkpoint: string;
  readonly completedAt: Date;
}

/**
 * O detalhe de um treinador para a gestão do admin/master (card #526).
 *
 * Junta três coisas que o André pediu para ver: o perfil em si, os alunos que
 * autorizaram o acesso e as respostas (avaliações) que o treinador já fez. Os
 * alunos vêm do mesmo lugar que a área do próprio treinador consome, para a
 * gestão enxergar exatamente o que ele enxerga.
 */
@Injectable()
export class AdminTrainerDetailUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sharing: ManageSharingUseCase,
  ) {}

  async execute(id: string): Promise<Result<AdminTrainerDetail>> {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        specialty: true,
        councilId: true,
        bio: true,
        status: true,
        approvedAt: true,
        createdAt: true,
      },
    });
    if (!profile) return fail(new NotFoundError('Treinador não encontrado.'));

    // Sem relação Prisma com User: nome e e-mail numa consulta à parte.
    const user = await this.prisma.user.findUnique({
      where: { id: profile.userId },
      select: { name: true, email: true },
    });

    const [students, assessments] = await Promise.all([
      this.sharing.listForProfessional(id),
      this.prisma.assessment.findMany({
        where: { professionalId: id },
        orderBy: { completedAt: 'desc' },
        select: { subjectId: true, checkpoint: true, completedAt: true },
      }),
    ]);

    // Nome do aluno para cada avaliação, reaproveitando o que já veio na lista
    // de alunos — o subjectId é a chave comum.
    const nameBySubject = new Map(students.map((s) => [s.subjectId, s.subjectName]));

    return ok({
      id: profile.id,
      name: user?.name ?? '—',
      email: user?.email ?? '—',
      specialty: profile.specialty,
      councilId: profile.councilId,
      bio: profile.bio,
      status: profile.status,
      approvedAt: profile.approvedAt,
      createdAt: profile.createdAt,
      students,
      assessments: assessments.map((a) => ({
        subjectName: nameBySubject.get(a.subjectId) ?? '—',
        checkpoint: a.checkpoint,
        completedAt: a.completedAt,
      })),
    });
  }
}
