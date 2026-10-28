import type { PrismaService } from '@infra/database/prisma.service';

import { SetPartnerShareUseCase } from './set-partner-share.use-case';

/** GC-AJ-029: a fatia muda pelo gerencial sem quebrar a regra da rede. */
describe('SetPartnerShareUseCase', () => {
  function build(partner: unknown) {
    const prisma = {
      partner: {
        findUnique: jest.fn(async () => partner),
        update: jest.fn(async ({ data }: { data: { sharePercent: number } }) => ({
          id: 'p1',
          sharePercent: data.sharePercent,
        })),
      },
      auditLog: { create: jest.fn(async () => ({})) },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    return { prisma, useCase: new SetPartnerShareUseCase(prisma as unknown as PrismaService) };
  }

  const raiz = { id: 'p1', sharePercent: 20, parent: null, children: [] };

  it('sobe a raiz de 20 para 35% e registra na auditoria', async () => {
    const { prisma, useCase } = build(raiz);
    const result = await useCase.execute('p1', 35, 'admin-1');

    expect(result.isOk() && result.value.sharePercent).toBe(35);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'partner.share_changed',
        metadata: { from: 20, to: 35 },
      }),
    });
  });

  it('recusa passar da fatia do pai', async () => {
    const { useCase } = build({
      ...raiz,
      parent: { displayName: 'Rede Sul', sharePercent: 10 },
    });
    const result = await useCase.execute('p1', 12, 'admin-1');
    expect(result.isFail() && result.error.message).toMatch(/Rede Sul, 10%/);
  });

  it('recusa ficar abaixo do maior filho, em vez de rebaixar a rede em cascata', async () => {
    const { prisma, useCase } = build({
      ...raiz,
      children: [{ displayName: 'Unidade Centro', sharePercent: 15 }],
    });
    const result = await useCase.execute('p1', 10, 'admin-1');
    expect(result.isFail() && result.error.message).toMatch(/Unidade Centro, 15%/);
    expect(prisma.partner.update).not.toHaveBeenCalled();
  });

  it('recusa zero e valores acima de 100', async () => {
    const { useCase } = build(raiz);
    expect((await useCase.execute('p1', 0, 'a')).isFail()).toBe(true);
    expect((await useCase.execute('p1', 120, 'a')).isFail()).toBe(true);
  });
});
