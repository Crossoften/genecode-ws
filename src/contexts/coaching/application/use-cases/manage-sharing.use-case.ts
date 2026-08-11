import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { ConflictError, ForbiddenError, NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, okVoid, type Result } from '@shared/domain/result';

export interface ShareRecord {
  readonly id: string;
  readonly subjectId: string;
  readonly professionalId: string;
  readonly professionalName: string;
  readonly specialty: string;
  readonly status: string;
  readonly initiatedBy: string;
  readonly requestedAt: Date;
  readonly authorizedAt: Date | null;
}

/**
 * Compartilhamento do laudo com um profissional.
 *
 * Suporta os **dois sentidos**, conforme a decisão F1 — as fontes divergiam:
 *
 * - A "Devolutiva Documento Fluxo V2" descreve o fluxo *pull*: o profissional
 *   solicita informando e-mail ou CPF, e o titular autoriza.
 * - A reunião de 16/07 descreve o *push*: o titular manda o código ao
 *   profissional.
 *
 * A diferença é só quem cria o registro e se ele nasce pendente. Quando o
 * **titular** inicia, a autorização é imediata: ele é o dono do dado e não
 * precisa da aprovação de ninguém. Quando o **profissional** inicia, nasce
 * `PENDING` e espera.
 *
 * Revogação é sempre self-service do titular, a qualquer momento — e o cliente
 * reconheceu o limite disso: *"se o cara tirou print da tela, aí já não é mais
 * responsabilidade nossa. A gente tira o acesso."*
 */
@Injectable()
export class ManageSharingUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /** O titular autoriza um profissional. Efeito imediato. */
  async grantByPatient(
    subjectId: string,
    professionalEmail: string,
    ipAddress?: string,
  ): Promise<Result<ShareRecord>> {
    const professional = await this.findProfessionalByEmail(professionalEmail);
    if (!professional) {
      return fail(new NotFoundError('Nenhum profissional cadastrado com este e-mail.'));
    }

    const existing = await this.prisma.dataSharing.findUnique({
      where: { subjectId_professionalId: { subjectId, professionalId: professional.id } },
    });

    if (existing?.status === 'AUTHORIZED') {
      return fail(new ConflictError('Este profissional já tem acesso.'));
    }

    const record = await this.prisma.dataSharing.upsert({
      where: { subjectId_professionalId: { subjectId, professionalId: professional.id } },
      update: { status: 'AUTHORIZED', authorizedAt: new Date(), revokedAt: null, ipAddress },
      create: {
        subjectId,
        professionalId: professional.id,
        status: 'AUTHORIZED',
        initiatedBy: 'PATIENT',
        authorizedAt: new Date(),
        ipAddress,
      },
    });

    await this.audit(subjectId, 'sharing.granted', record.id, ipAddress);

    return ok(this.toRecord(record, professional));
  }

  /** O profissional solicita acesso. Nasce pendente e espera o titular. */
  async requestByProfessional(
    professionalId: string,
    subjectId: string,
  ): Promise<Result<ShareRecord>> {
    const professional = await this.prisma.professionalProfile.findUnique({
      where: { id: professionalId },
    });
    if (!professional) return fail(new NotFoundError('Perfil profissional não encontrado.'));

    const existing = await this.prisma.dataSharing.findUnique({
      where: { subjectId_professionalId: { subjectId, professionalId } },
    });

    if (existing?.status === 'AUTHORIZED') {
      return fail(new ConflictError('Você já tem acesso a esta pessoa.'));
    }

    const record = await this.prisma.dataSharing.upsert({
      where: { subjectId_professionalId: { subjectId, professionalId } },
      update: { status: 'PENDING', requestedAt: new Date() },
      create: { subjectId, professionalId, status: 'PENDING', initiatedBy: 'PROFESSIONAL' },
    });

    return ok(this.toRecord(record, { ...professional, name: '' }));
  }

  /**
   * O titular revoga o acesso.
   *
   * Só o titular pode. Um profissional não deve conseguir remover o próprio
   * registro para apagar o rastro de que teve acesso.
   */
  async revoke(subjectId: string, sharingId: string, ipAddress?: string): Promise<Result<void>> {
    const sharing = await this.prisma.dataSharing.findUnique({ where: { id: sharingId } });

    if (!sharing) return fail(new NotFoundError('Compartilhamento não encontrado.'));
    if (sharing.subjectId !== subjectId) {
      return fail(new ForbiddenError('Você só pode revogar os seus próprios compartilhamentos.'));
    }

    await this.prisma.dataSharing.update({
      where: { id: sharingId },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    await this.audit(subjectId, 'sharing.revoked', sharingId, ipAddress);

    return okVoid();
  }

  /**
   * Sharings of one account's subjects, for the privacy screen.
   *
   * Reads across ALL of the user's subjects — not just the most recent link —
   * because an account can hold more than one kit (own + gifted activation),
   * and the privacy modal must reflect every grant the person can revoke.
   * Revoked records stay out: the screen derives "inactive" from the absence
   * of an AUTHORIZED record, and history belongs to the audit trail.
   */
  async listForSubjects(subjectIds: readonly string[]): Promise<ShareRecord[]> {
    if (subjectIds.length === 0) return [];

    const records = await this.prisma.dataSharing.findMany({
      where: { subjectId: { in: [...subjectIds] }, status: { not: 'REVOKED' } },
      include: { professional: true },
      orderBy: { requestedAt: 'desc' },
    });
    if (records.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: records.map((record) => record.professional.userId) } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((user) => [user.id, user.name]));

    return records.map((record) =>
      this.toRecord(record, {
        ...record.professional,
        name: names.get(record.professional.userId) ?? '',
      }),
    );
  }

  /** Pessoas que autorizaram este profissional. */
  async listForProfessional(professionalId: string): Promise<ShareRecord[]> {
    const records = await this.prisma.dataSharing.findMany({
      where: { professionalId, status: 'AUTHORIZED' },
      include: { professional: true },
      orderBy: { authorizedAt: 'desc' },
    });

    return records.map((record) => this.toRecord(record, { ...record.professional, name: '' }));
  }

  private async findProfessionalByEmail(email: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    if (!user) return null;

    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) return null;

    return { ...profile, name: user.name, email: user.email };
  }

  /** Acesso a dado genético sempre entra na trilha. */
  private async audit(
    userId: string,
    action: string,
    resourceId: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: { action, resource: 'data_sharing', resourceId, ipAddress },
    });
    void userId;
  }

  private toRecord(
    record: { id: string; subjectId: string; professionalId: string; status: string; initiatedBy: string; requestedAt: Date; authorizedAt: Date | null },
    professional: { specialty: string; name: string },
  ): ShareRecord {
    return {
      id: record.id,
      subjectId: record.subjectId,
      professionalId: record.professionalId,
      professionalName: professional.name,
      specialty: professional.specialty,
      status: record.status,
      initiatedBy: record.initiatedBy,
      requestedAt: record.requestedAt,
      authorizedAt: record.authorizedAt,
    };
  }
}
