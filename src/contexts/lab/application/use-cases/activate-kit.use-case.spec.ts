import type { PrismaService } from '@infra/database/prisma.service';
import { DomainErrorKind } from '@shared/domain/domain-error';

import { CodeValidation } from '../../domain/activation-code';
import { ActivateKitUseCase } from './activate-kit.use-case';

/**
 * Guarda do registro do kit.
 *
 * O que estes testes protegem é a frase do cliente que justifica o caso de uso
 * inteiro: *"o DNA que seja colhido depois"* não pode ir parar no nome de outra
 * pessoa.
 *
 * Desde 06/10 é **aqui** que o número sai da lista primitiva. As etiquetas já
 * estão impressas antes de o sistema ver qualquer uma; o despacho não registra
 * qual caixa levou qual adesivo; e o sistema só descobre o número quando
 * alguém abre a caixa e o digita. Achou, queimou — e o kit nasce nesse
 * instante.
 *
 * `123456-01` é válido no módulo 11, então o que muda de teste para teste é só
 * o que o banco tem a dizer sobre ele.
 */
describe('ActivateKitUseCase', () => {
  const CODE = '123456-01';

  interface Cenario {
    /** A linha da lista oficial, ou null quando o código não está nela. */
    daLista?: { sequencial: number; code: string; usable: boolean } | null;
    /** Kit já existente, quando alguém já registrou este número. */
    kit?: {
      id: string;
      status: string;
      subjectId: string | null;
      activatedByUserId: string | null;
      activatedAt: Date | null;
    } | null;
    /** Pedidos da conta à espera de kit. */
    pedidos?: { id: string }[];
    /** Pedidos que já têm kit. */
    pedidosComKit?: string[];
  }

  function montar(cenario: Cenario = {}) {
    const {
      daLista = { sequencial: 42, code: CODE, usable: true },
      kit = null,
      pedidos = [],
      pedidosComKit = [],
    } = cenario;

    const tx = {
      subject: { create: jest.fn(async () => ({ id: 'titular-1' })) },
      subjectLink: { create: jest.fn(async () => ({})) },
      kit: { create: jest.fn(async () => ({ id: 'kit-novo' })) },
      activationCode: { update: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    };

    const prisma = {
      activationCode: { findUnique: jest.fn(async () => daLista) },
      kit: {
        findUnique: jest.fn(async () => kit),
        findMany: jest.fn(async () => pedidosComKit.map((orderId) => ({ orderId }))),
      },
      order: { findMany: jest.fn(async () => pedidos) },
      $transaction: jest.fn(async (run: (client: typeof tx) => Promise<string>) => run(tx)),
    };

    return { tx, prisma };
  }

  const useCase = (prisma: ReturnType<typeof montar>['prisma']) =>
    new ActivateKitUseCase(prisma as unknown as PrismaService);

  it('registra o número da lista, cria o kit e queima o código', async () => {
    const { prisma, tx } = montar();

    const result = await useCase(prisma).execute({ code: CODE, userId: 'user-1' });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.subjectId).toBe('titular-1');
      expect(result.value.alreadyActivated).toBe(false);
    }
    expect(tx.kit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ code: CODE, status: 'ACTIVATED' }),
      }),
    );
    // A baixa na lista vai na MESMA transação do kit: senão sobra um kit sem
    // baixa, ou uma baixa sem kit.
    expect(tx.activationCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: CODE } }),
    );
    expect(tx.subjectLink.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', subjectId: 'titular-1', relation: 'SELF' },
    });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('recusa número que não está na lista da Genoa', async () => {
    // O módulo 11 deixa passar ~1 em cada 100 sequências. Sem a lista, varrer
    // códigos daria titular de graça a quem acertasse.
    const { prisma, tx } = montar({ daLista: null });

    const result = await useCase(prisma).execute({ code: CODE, userId: 'invasor' });

    expect(result.isFail()).toBe(true);
    expect(tx.subject.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('não distingue "fora da lista" de "formato errado"', async () => {
    // Distinguir os dois devolveria, a quem varre, o mapa de quais números
    // existem.
    const foraDaLista = montar({ daLista: null });
    const result = await useCase(foraDaLista.prisma).execute({ code: CODE, userId: 'invasor' });

    expect(result.isFail()).toBe(true);
    if (result.isFail()) {
      expect(result.error.message).toBe(CodeValidation.WRONG_CODE);
      expect(result.error.kind).toBe(DomainErrorKind.NOT_FOUND);
    }
  });

  it('recusa os oito de base trivial, que estão na lista mas o validador rejeita', async () => {
    const { prisma, tx } = montar({
      daLista: { sequencial: 227837, code: CODE, usable: false },
    });

    const result = await useCase(prisma).execute({ code: CODE, userId: 'user-1' });

    expect(result.isFail()).toBe(true);
    expect(tx.kit.create).not.toHaveBeenCalled();
  });

  it('amarra o kit ao pedido de quem comprou, quando é a mesma pessoa', async () => {
    const { prisma, tx } = montar({ pedidos: [{ id: 'pedido-1' }] });

    await useCase(prisma).execute({ code: CODE, userId: 'user-1' });

    expect(tx.kit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderId: 'pedido-1' }) }),
    );
  });

  it('registra sem pedido nenhum — o kit pode ser presente', async () => {
    // O cliente descreveu em 02/10: alguém compra três kits, para si, para a
    // esposa e para o filho. Esposa e filho registram o deles sem ter pedido.
    const { prisma, tx } = montar({ pedidos: [] });

    const result = await useCase(prisma).execute({ code: CODE, userId: 'esposa' });

    expect(result.isOk()).toBe(true);
    expect(tx.kit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderId: null }) }),
    );
  });

  it('não reusa um pedido que já tem kit', async () => {
    // Quem comprou dois kits registra dois números: o segundo não pode cair no
    // pedido do primeiro.
    const { prisma, tx } = montar({
      pedidos: [{ id: 'pedido-1' }, { id: 'pedido-2' }],
      pedidosComKit: ['pedido-1'],
    });

    await useCase(prisma).execute({ code: CODE, userId: 'user-1' });

    expect(tx.kit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderId: 'pedido-2' }) }),
    );
  });

  it('é idempotente para quem clicou duas vezes', async () => {
    const activatedAt = new Date(2026, 9, 6, 10, 30);
    const { prisma, tx } = montar({
      kit: {
        id: 'kit-1',
        status: 'ACTIVATED',
        subjectId: 'titular-9',
        activatedByUserId: 'user-1',
        activatedAt,
      },
    });

    const result = await useCase(prisma).execute({ code: CODE, userId: 'user-1' });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.alreadyActivated).toBe(true);
      expect(result.value.subjectId).toBe('titular-9');
      expect(result.value.activatedAt).toBe(activatedAt);
    }
    expect(tx.subject.create).not.toHaveBeenCalled();
  });

  it('recusa quem tenta assumir número já registrado por outra pessoa', async () => {
    const { prisma } = montar({
      kit: {
        id: 'kit-1',
        status: 'ACTIVATED',
        subjectId: 'titular-9',
        activatedByUserId: 'user-1',
        activatedAt: new Date(),
      },
    });

    const result = await useCase(prisma).execute({ code: CODE, userId: 'user-2' });

    expect(result.isFail()).toBe(true);
    if (result.isFail()) {
      expect(result.error.kind).toBe(DomainErrorKind.CONFLICT);
      expect(result.error.message).toContain('já foi registrado por outra pessoa');
    }
  });

  it('recusa kit descartado com mensagem própria, porque aí o suporte resolve', async () => {
    const { prisma } = montar({
      kit: {
        id: 'kit-1',
        status: 'DISCARDED',
        subjectId: null,
        activatedByUserId: null,
        activatedAt: null,
      },
    });

    const result = await useCase(prisma).execute({ code: CODE, userId: 'user-1' });

    expect(result.isFail()).toBe(true);
    if (result.isFail()) {
      expect(result.error.kind).toBe(DomainErrorKind.CONFLICT);
      expect(result.error.message).toContain('descartado');
    }
  });

  it('recusa código malformado antes de ir ao banco', async () => {
    const { prisma } = montar();

    const result = await useCase(prisma).execute({ code: '12345', userId: 'user-1' });

    expect(result.isFail()).toBe(true);
    if (result.isFail()) expect(result.error.message).toBe(CodeValidation.WRONG_FORMAT);
    expect(prisma.activationCode.findUnique).not.toHaveBeenCalled();
  });
});
