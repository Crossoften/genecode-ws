import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

/**
 * Uma linha da tela de gestão de treinadores (card #526).
 *
 * É o resumo que o admin/master vê na lista: quem é, a ocupação declarada, a
 * situação da curadoria e os dois números que importam para saber se o perfil
 * está sendo usado — quantos alunos autorizaram o acesso e quantas avaliações
 * ele já registrou.
 */
export interface AdminTrainerRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** Ocupação / área de atuação, autodeclarada de uma lista fechada. */
  readonly specialty: string;
  /** Registro de conselho, quando a pessoa informou. */
  readonly councilId: string | null;
  /** Situação da curadoria: PENDING, APPROVED ou REJECTED. Hoje nasce APPROVED. */
  readonly status: string;
  /** Alunos que autorizaram este treinador a ver o laudo. */
  readonly students: number;
  /** Avaliações ambientais que este treinador já registrou. */
  readonly assessments: number;
  readonly createdAt: Date;
}

export interface AdminTrainersKpis {
  readonly total: number;
  readonly approved: number;
  readonly pending: number;
}

export interface AdminTrainersView {
  readonly kpis: AdminTrainersKpis;
  readonly rows: readonly AdminTrainerRow[];
}

/**
 * A lista de treinadores para a gestão do admin/master.
 *
 * Só leitura: a tela mostra os perfis, a situação de cada um e o quanto estão
 * em uso. A aprovação é automática hoje; a moderação (aprovar/recusar à mão)
 * fica para o próximo passo, e por isso os contadores de PENDING já existem.
 */
@Injectable()
export class ListAdminTrainersUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<AdminTrainersView> {
    const profiles = await this.prisma.professionalProfile.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        specialty: true,
        councilId: true,
        status: true,
        createdAt: true,
        _count: {
          select: {
            // Só os compartilhamentos vigentes contam como "aluno": um acesso
            // revogado não é mais um aluno ativo deste treinador.
            shares: { where: { status: 'AUTHORIZED' } },
            assessments: true,
          },
        },
      },
    });

    // ProfessionalProfile guarda só o userId (não há relação Prisma com User):
    // o nome e o e-mail vêm numa segunda consulta, pela chave em comum.
    const users = await this.prisma.user.findMany({
      where: { id: { in: profiles.map((profile) => profile.userId) } },
      select: { id: true, name: true, email: true },
    });
    const userById = new Map(users.map((user) => [user.id, user]));

    const rows: AdminTrainerRow[] = profiles.map((profile) => ({
      id: profile.id,
      name: userById.get(profile.userId)?.name ?? '—',
      email: userById.get(profile.userId)?.email ?? '—',
      specialty: profile.specialty,
      councilId: profile.councilId,
      status: profile.status,
      students: profile._count.shares,
      assessments: profile._count.assessments,
      createdAt: profile.createdAt,
    }));

    return {
      kpis: {
        total: rows.length,
        approved: rows.filter((row) => row.status === 'APPROVED').length,
        pending: rows.filter((row) => row.status === 'PENDING').length,
      },
      rows,
    };
  }
}
