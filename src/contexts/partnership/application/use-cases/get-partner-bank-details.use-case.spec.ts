import type { PrismaService } from '@infra/database/prisma.service';
import { NotFoundError } from '@shared/domain/domain-error';

import { GetPartnerBankDetailsUseCase } from './get-partner-bank-details.use-case';

describe('GetPartnerBankDetailsUseCase', () => {
  function partnerRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'parceiro-1',
      userId: 'user-1',
      displayName: 'Marina Costa',
      pixKeyType: null,
      pixKey: null,
      bankName: null,
      bankBranch: null,
      bankAccount: null,
      ...overrides,
    };
  }

  function buildPrisma(partner: ReturnType<typeof partnerRow> | null) {
    return { partner: { findUnique: jest.fn(async () => partner) } };
  }

  const useCase = (prisma: ReturnType<typeof buildPrisma>) =>
    new GetPartnerBankDetailsUseCase(prisma as unknown as PrismaService);

  it('parceiro sem dados cadastrados devolve campos null, não erro', async () => {
    const result = await useCase(buildPrisma(partnerRow())).execute('user-1');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        pixKeyType: null,
        pixKey: null,
        bankName: null,
        bankBranch: null,
        bankAccount: null,
        accountHolder: 'Marina Costa',
      });
    }
  });

  it('devolve os dados cadastrados com titular = displayName', async () => {
    const prisma = buildPrisma(
      partnerRow({
        pixKeyType: 'EMAIL',
        pixKey: 'marina@email.com',
        bankName: 'Nubank',
        bankBranch: '0001',
        bankAccount: '1234567-8',
      }),
    );

    const result = await useCase(prisma).execute('user-1');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.pixKey).toBe('marina@email.com');
      expect(result.value.bankAccount).toBe('1234567-8');
      expect(result.value.accountHolder).toBe('Marina Costa');
    }
  });

  it('devolve 404 para usuário sem perfil de parceiro', async () => {
    const result = await useCase(buildPrisma(null)).execute('user-x');

    expect(result.isFail()).toBe(true);
    if (result.isFail()) expect(result.error).toBeInstanceOf(NotFoundError);
  });
});
