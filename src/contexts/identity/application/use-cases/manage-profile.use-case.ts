import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

export interface PatientProfile {
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly addressLine: string | null;
  readonly addressZip: string | null;
  /** Imutáveis após o cadastro — a tela os exibe como "dados protegidos". */
  readonly protectedData: {
    readonly document: string | null;
    readonly birthDate: Date | null;
    readonly biologicalSex: string | null;
  };
}

export interface UpdateProfileInput {
  readonly name?: string;
  readonly phone?: string | null;
  readonly addressLine?: string | null;
  readonly addressZip?: string | null;
}

/**
 * Reads and updates the signed-in person's own profile.
 *
 * The write path only accepts the editable fields. `document`, `birthDate` and
 * `biologicalSex` are deliberately not part of {@link UpdateProfileInput}:
 * they anchor the genetic report to a person, and the client defined them as
 * immutable after sign-up ("dados protegidos" in the prototype). E-mail is
 * also out — changing it requires the confirmation-code flow, not a PATCH.
 */
@Injectable()
export class ManageProfileUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<Result<PatientProfile>> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        name: true,
        email: true,
        phone: true,
        addressLine: true,
        addressZip: true,
        document: true,
        birthDate: true,
        biologicalSex: true,
      },
    });
    if (!user) return fail(new NotFoundError('Conta não encontrada.'));

    return ok(this.toProfile(user));
  }

  async update(userId: string, input: UpdateProfileInput): Promise<Result<PatientProfile>> {
    const exists = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) return fail(new NotFoundError('Conta não encontrada.'));

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
        ...(input.addressZip !== undefined ? { addressZip: input.addressZip } : {}),
      },
      select: {
        name: true,
        email: true,
        phone: true,
        addressLine: true,
        addressZip: true,
        document: true,
        birthDate: true,
        biologicalSex: true,
      },
    });

    return ok(this.toProfile(user));
  }

  private toProfile(user: {
    name: string;
    email: string;
    phone: string | null;
    addressLine: string | null;
    addressZip: string | null;
    document: string | null;
    birthDate: Date | null;
    biologicalSex: string | null;
  }): PatientProfile {
    return {
      name: user.name,
      email: user.email,
      phone: user.phone,
      addressLine: user.addressLine,
      addressZip: user.addressZip,
      protectedData: {
        document: user.document,
        birthDate: user.birthDate,
        biologicalSex: user.biologicalSex,
      },
    };
  }
}
