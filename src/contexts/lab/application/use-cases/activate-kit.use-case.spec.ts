import type { PrismaService } from '@infra/database/prisma.service';
import { DomainErrorKind } from '@shared/domain/domain-error';

import { CodeValidation } from '../../domain/activation-code';
import { ActivateKitUseCase } from './activate-kit.use-case';

/**
 * Guarda de ativação do kit.
 *
 * O que estes testes protegem é a frase do cliente que justifica o caso de uso
 * inteiro: *"o DNA que seja colhido depois"* não pode ir parar no nome de outra
 * pessoa. O caminho de ataque encontrado na revisão de 09/09 era o kit ainda em
 * estoque — como ~1 em cada 100 sequências passa no módulo 11, varrer códigos
 * acabava acertando uma caixa não vendida, e quem acertasse virava titular.
 *
 * `123456-01` é um código válido no módulo 11 (o mesmo usado no teste do
 * domínio), então o que muda de teste para teste é só o estado do kit no banco.
 */
describe('ActivateKitUseCase', () => {
  const CODE = '123456-01';

  interface KitRow {
    id: string;
    code: string;
    status: string;
    subjectId: string | null;
    activatedByUserId: string | null;
    activatedAt: Date | null;
  }

  function kitRow(overrides: Partial<KitRow> = {}): KitRow {
    return {
      id: 'kit-1',
      code: CODE,
      status: 'ASSIGNED',
      subjectId: null,
      activatedByUserId: null,
      activatedAt: null,
      ...overrides,
    };
  }

  function buildPrisma(kit: KitRow | null) {
    const tx = {
      subject: { create: jest.fn(async () => ({ id: 'titular-1' })) },
      subjectLink: { create: jest.fn(async () => ({})) },
      kit: { update: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    };

    return {
      tx,
      prisma: {
        kit: {
          findUnique: jest.fn(async ({ where }: { where: { code: string } }) =>
            kit !== null && where.code === kit.code ? kit : null,
          ),
        },
        $transaction: jest.fn(async (run: (client: typeof tx) => Promise<string>) => run(tx)),
      },
    };
  }

  const useCase = (prisma: ReturnType<typeof buildPrisma>['prisma']) =>
    new ActivateKitUseCase(prisma as unknown as PrismaService);

  it('ativa o kit despachado e torna quem ativou o titular', async () => {
    const { prisma, tx } = buildPrisma(kitRow());

    const result = await useCase(prisma).execute({ code: CODE, userId: 'user-1' });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.subjectId).toBe('titular-1');
      expect(result.value.alreadyActivated).toBe(false);
    }
    expect(tx.subjectLink.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', subjectId: 'titular-1', relation: 'SELF' },
    });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('recusa kit que nunca saiu do estoque', async () => {
    const { prisma, tx } = buildPrisma(kitRow({ status: 'GENERATED' }));

    const result = await useCase(prisma).execute({ code: CODE, userId: 'invasor' });

    expect(result.isFail()).toBe(true);
    // Nada de titular criado: o sequestro do kit em estoque era exatamente isto.
    expect(tx.subject.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('não revela que o código existe quando o kit está em estoque', async () => {
    // Mesma mensagem e mesmo kind de código inexistente: distinguir os dois
    // devolveria ao atacante o mapa de quais códigos foram emitidos.
    const emEstoque = buildPrisma(kitRow({ status: 'GENERATED' }));
    const inexistente = buildPrisma(null);

    const recusado = await useCase(emEstoque.prisma).execute({ code: CODE, userId: 'invasor' });
    const desconhecido = await useCase(inexistente.prisma).execute({
      code: CODE,
      userId: 'invasor',
    });

    expect(recusado.isFail()).toBe(true);
    expect(desconhecido.isFail()).toBe(true);
    if (recusado.isFail() && desconhecido.isFail()) {
      expect(recusado.error.message).toBe(CodeValidation.WRONG_CODE);
      expect(recusado.error.message).toBe(desconhecido.error.message);
      expect(recusado.error.kind).toBe(desconhecido.error.kind);
      expect(recusado.error.kind).toBe(DomainErrorKind.NOT_FOUND);
    }
  });

  it('recusa kit descartado com mensagem própria, porque aí o suporte resolve', async () => {
    const { prisma } = buildPrisma(kitRow({ status: 'DISCARDED' }));

    const result = await useCase(prisma).execute({ code: CODE, userId: 'user-1' });

    expect(result.isFail()).toBe(true);
    if (result.isFail()) {
      expect(result.error.kind).toBe(DomainErrorKind.CONFLICT);
      expect(result.error.message).toContain('descartado');
    }
  });

  it('é idempotente para o mesmo titular que clicou duas vezes', async () => {
    const activatedAt = new Date(2026, 8, 9, 10, 30);
    const { prisma, tx } = buildPrisma(
      kitRow({
        status: 'ACTIVATED',
        subjectId: 'titular-9',
        activatedByUserId: 'user-1',
        activatedAt,
      }),
    );

    const result = await useCase(prisma).execute({ code: CODE, userId: 'user-1' });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.alreadyActivated).toBe(true);
      expect(result.value.subjectId).toBe('titular-9');
      expect(result.value.activatedAt).toBe(activatedAt);
    }
    expect(tx.subject.create).not.toHaveBeenCalled();
  });

  it('recusa quem tenta assumir kit já ativado por outra pessoa', async () => {
    const { prisma } = buildPrisma(
      kitRow({ status: 'ACTIVATED', subjectId: 'titular-9', activatedByUserId: 'user-1' }),
    );

    const result = await useCase(prisma).execute({ code: CODE, userId: 'user-2' });

    expect(result.isFail()).toBe(true);
    if (result.isFail()) {
      expect(result.error.kind).toBe(DomainErrorKind.CONFLICT);
      expect(result.error.message).toContain('já foi ativado por outra pessoa');
    }
  });

  it('recusa código malformado antes de ir ao banco', async () => {
    const { prisma } = buildPrisma(kitRow());

    const result = await useCase(prisma).execute({ code: '12345', userId: 'user-1' });

    expect(result.isFail()).toBe(true);
    if (result.isFail()) expect(result.error.message).toBe(CodeValidation.WRONG_FORMAT);
    expect(prisma.kit.findUnique).not.toHaveBeenCalled();
  });
});
