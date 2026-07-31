import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

export interface PatientKit {
  readonly code: string;
  readonly status: string;
  readonly activatedAt: Date | null;
}

export interface PatientReport {
  readonly id: string;
  readonly panelName: string;
  readonly publishedAt: Date | null;
  readonly globalIndex: number | null;
  readonly band: string | null;
}

export interface PatientArea {
  readonly kits: readonly PatientKit[];
  readonly reports: readonly PatientReport[];
  /** Pedidos em andamento, para a pessoa não precisar guardar o número. */
  readonly orders: readonly {
    readonly number: string;
    readonly status: string;
    readonly createdAt: Date;
  }[];
}

/**
 * Resumo da área do paciente.
 *
 * Reúne o que a pessoa logada tem: kits registrados, laudos publicados e
 * pedidos em andamento.
 *
 * ### Por que os laudos passam pelo `SubjectLink`
 *
 * Um usuário não "tem" laudos — ele tem vínculo com **titulares**, e são os
 * titulares que têm laudo. A distinção parece burocrática até o caso real
 * aparecer: o kit comprado de presente é registrado por quem coleta, e essa
 * pessoa pode ser diferente de quem pagou. Consultar por `userId` direto
 * entregaria o laudo à pessoa errada exatamente no caso que o cliente mais
 * destacou.
 *
 * Só laudos `PUBLISHED` entram. Um rascunho ou uma versão superada não são
 * documentos vigentes, e mostrar os dois deixaria o paciente com dois resultados
 * "atuais" do mesmo exame.
 */
@Injectable()
export class PatientAreaUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param userId - Conta autenticada.
   */
  async execute(userId: string): Promise<PatientArea> {
    const links = await this.prisma.subjectLink.findMany({
      where: { userId },
      select: { subjectId: true },
    });
    const subjectIds = links.map((link) => link.subjectId);

    const [kits, reports, orders] = await Promise.all([
      this.prisma.kit.findMany({
        where: { activatedByUserId: userId },
        orderBy: { activatedAt: 'desc' },
        select: { code: true, status: true, activatedAt: true },
      }),

      subjectIds.length === 0
        ? []
        : this.prisma.report.findMany({
            where: { subjectId: { in: subjectIds }, status: 'PUBLISHED' },
            orderBy: { publishedAt: 'desc' },
            include: {
              panel: { select: { name: true } },
              modalityIndexes: {
                where: { modality: { isGlobal: true } },
                select: { normalizedIndex: true, band: true },
              },
            },
          }),

      this.prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { number: true, status: true, createdAt: true },
      }),
    ]);

    return {
      kits,
      orders,
      reports: reports.map((report) => {
        const global = report.modalityIndexes[0];
        return {
          id: report.id,
          panelName: report.panel.name,
          publishedAt: report.publishedAt,
          globalIndex: global ? Number(global.normalizedIndex) : null,
          band: global?.band ?? null,
        };
      }),
    };
  }
}
