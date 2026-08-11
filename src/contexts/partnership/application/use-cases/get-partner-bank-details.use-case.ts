import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

export interface PartnerBankDetails {
  readonly pixKeyType: string | null;
  readonly pixKey: string | null;
  readonly bankName: string | null;
  readonly bankBranch: string | null;
  readonly bankAccount: string | null;
  readonly accountHolder: string;
}

/**
 * Current payout details of the logged-in partner.
 *
 * Fields the partner never filled come back `null` — the screen renders the
 * empty form, not an error.
 */
@Injectable()
export class GetPartnerBankDetailsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(userId: string): Promise<Result<PartnerBankDetails>> {
    const partner = await this.prisma.partner.findUnique({ where: { userId } });
    if (!partner) return fail(new NotFoundError('Perfil de parceiro não encontrado.'));

    return ok({
      pixKeyType: partner.pixKeyType,
      pixKey: partner.pixKey,
      bankName: partner.bankName,
      bankBranch: partner.bankBranch,
      bankAccount: partner.bankAccount,
      // Titular = displayName é decisão registrada: não há coluna própria e
      // não haverá migração para isso nesta onda.
      accountHolder: partner.displayName,
    });
  }
}
