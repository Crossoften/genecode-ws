import { Prisma } from '@prisma/client';

import type { PrismaService } from '@infra/database/prisma.service';

import { SolicitacaoParceiroUseCase, type PedidoDeParceria } from './solicitacao-parceiro.use-case';

/**
 * GC-N05-14: quem já tem conta pede para virar parceiro; o admin aprova.
 *
 * O banco é um dublê em memória só com o que o caso de uso toca — o bastante
 * para provar as três regras: não duplica, exige aprovação, não decide duas
 * vezes.
 */
describe('SolicitacaoParceiroUseCase', () => {
  const CPF_DA_CONTA = '52998224725';

  interface Pedido {
    id: string;
    userId: string;
    pendingUserId: string | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    type: 'INDIVIDUAL' | 'COMPANY';
    displayName: string;
    document: string;
    channel: string;
    pixKeyType: string | null;
    pixKey: string | null;
    note: string | null;
    decidedAt: Date | null;
    decisionNote: string | null;
    partnerId: string | null;
    createdAt: Date;
  }

  function build(opcoes: { jaEParceiro?: boolean; cpfDeOutraConta?: boolean } = {}) {
    const pedidos: Pedido[] = [];
    const parceiros: Array<{ id: string; userId: string; couponCode: string; document: string }> =
      opcoes.jaEParceiro
        ? [{ id: 'p0', userId: 'u1', couponCode: 'ANA222', document: CPF_DA_CONTA }]
        : [];
    const papeis: Array<{ userId: string; roleId: string }> = [];
    let seq = 0;

    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u1',
          name: 'Ana Treinadora',
          email: 'ana@email.com',
          document: CPF_DA_CONTA,
          phone: '11999990000',
        })),
        findFirst: jest.fn(async () => (opcoes.cpfDeOutraConta ? { id: 'u2' } : null)),
        findMany: jest.fn(async () => []),
      },
      partner: {
        findUnique: jest.fn(
          async ({ where }: { where: { userId: string } }) =>
            parceiros.find((p) => p.userId === where.userId) ?? null,
        ),
        findFirst: jest.fn(async () => null),
        create: jest.fn(
          async ({ data }: { data: { userId: string; couponCode: string; document: string } }) => {
            const criado = { id: `p${++seq}`, ...data };
            parceiros.push(criado);
            return criado;
          },
        ),
      },
      coupon: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async () => ({})),
      },
      role: { findUnique: jest.fn(async () => ({ id: 'r-affiliate' })) },
      userRole: {
        upsert: jest.fn(async ({ create }: { create: { userId: string; roleId: string } }) => {
          papeis.push(create);
          return create;
        }),
      },
      auditLog: { create: jest.fn(async () => ({})) },
      partnerApplication: {
        findUnique: jest.fn(
          async ({ where }: { where: { id?: string; pendingUserId?: string } }) =>
            pedidos.find((p) =>
              where.id ? p.id === where.id : p.pendingUserId === where.pendingUserId,
            ) ?? null,
        ),
        findFirst: jest.fn(async () => pedidos.at(-1) ?? null),
        findMany: jest.fn(async () => pedidos),
        create: jest.fn(
          async ({
            data,
          }: {
            data: Omit<
              Pedido,
              'id' | 'status' | 'createdAt' | 'decidedAt' | 'decisionNote' | 'partnerId'
            >;
          }) => {
            if (pedidos.some((p) => p.pendingUserId === data.pendingUserId)) {
              throw new Prisma.PrismaClientKnownRequestError('unique', {
                code: 'P2002',
                clientVersion: 'test',
              });
            }
            const novo: Pedido = {
              ...data,
              id: `s${++seq}`,
              status: 'PENDING',
              createdAt: new Date(),
              decidedAt: null,
              decisionNote: null,
              partnerId: null,
            };
            pedidos.push(novo);
            return novo;
          },
        ),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string; status: string };
            data: Partial<Pedido>;
          }) => {
            const alvo = pedidos.filter((p) => p.id === where.id && p.status === where.status);
            alvo.forEach((p) => Object.assign(p, data));
            return { count: alvo.length };
          },
        ),
        update: jest.fn(
          async ({ where, data }: { where: { id: string }; data: Partial<Pedido> }) => {
            const alvo = pedidos.find((p) => p.id === where.id)!;
            Object.assign(alvo, data);
            return alvo;
          },
        ),
      },
      $transaction: jest.fn(),
    };
    // A transação roda no próprio dublê: o que importa aqui é a regra, não o
    // isolamento do MySQL.
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    );

    return {
      prisma,
      pedidos,
      parceiros,
      papeis,
      useCase: new SolicitacaoParceiroUseCase(prisma as unknown as PrismaService),
    };
  }

  const pedido: PedidoDeParceria = {
    type: 'INDIVIDUAL',
    channel: 'Academia Corpo em Forma, Zona Norte',
    pixKeyType: 'EMAIL',
    pixKey: 'ana@email.com',
  };

  describe('pedir', () => {
    it('abre o pedido com o CPF e o nome da conta, sem dar papel nem criar cupom', async () => {
      const { useCase, pedidos, prisma } = build();

      const result = await useCase.solicitar('u1', pedido);

      expect(result.isOk() && result.value.status).toBe('PENDING');
      expect(pedidos).toHaveLength(1);
      expect(pedidos[0]).toMatchObject({
        userId: 'u1',
        pendingUserId: 'u1',
        document: CPF_DA_CONTA,
        displayName: 'Ana Treinadora',
      });
      // Exige aprovação: nada de parceiro, cupom ou papel antes do admin.
      expect(prisma.partner.create).not.toHaveBeenCalled();
      expect(prisma.coupon.create).not.toHaveBeenCalled();
      expect(prisma.userRole.upsert).not.toHaveBeenCalled();
    });

    it('não abre um segundo pedido enquanto o primeiro está em análise', async () => {
      const { useCase, pedidos } = build();
      await useCase.solicitar('u1', pedido);

      const segundo = await useCase.solicitar('u1', pedido);

      expect(segundo.isFail() && segundo.error.kind).toBe('CONFLICT');
      expect(pedidos).toHaveLength(1);
    });

    it('dois cliques ao mesmo tempo: o índice único segura e vira conflito, não 500', async () => {
      const { useCase, prisma } = build();
      // Os dois passam pela leitura antes de qualquer um gravar.
      prisma.partnerApplication.findUnique.mockResolvedValue(null);

      const [a, b] = await Promise.all([
        useCase.solicitar('u1', pedido),
        useCase.solicitar('u1', pedido),
      ]);

      expect([a, b].filter((r) => r.isFail())).toHaveLength(1);
    });

    it('recusa quem já é parceiro', async () => {
      const { useCase, pedidos } = build({ jaEParceiro: true });
      const result = await useCase.solicitar('u1', pedido);
      expect(result.isFail() && result.error.message).toMatch(/já é parceira/);
      expect(pedidos).toHaveLength(0);
    });

    it('não deixa trocar o CPF da conta por outro', async () => {
      const { useCase } = build();
      const result = await useCase.solicitar('u1', { ...pedido, document: '153.509.460-56' });
      expect(result.isFail() && result.error.kind).toBe('VALIDATION');
    });

    it('recusa chave Pix inválida', async () => {
      const { useCase } = build();
      const result = await useCase.solicitar('u1', {
        ...pedido,
        pixKeyType: 'PHONE',
        pixKey: '123',
      });
      expect(result.isFail() && result.error.kind).toBe('VALIDATION');
    });
  });

  describe('aprovar', () => {
    it('cria o parceiro com cupom e SOMA o papel de parceiro à conta', async () => {
      const { useCase, pedidos, parceiros, papeis, prisma } = build();
      await useCase.solicitar('u1', pedido);

      const result = await useCase.aprovar(pedidos[0].id, 'admin-1');

      expect(result.isOk() && result.value.status).toBe('APPROVED');
      expect(result.isOk() && result.value.couponCode).toMatch(/^ANATREINAD/);
      expect(parceiros).toHaveLength(1);
      expect(papeis).toEqual([{ userId: 'u1', roleId: 'r-affiliate' }]);
      expect(pedidos[0]).toMatchObject({ status: 'APPROVED', pendingUserId: null });
      expect(prisma.partner.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ pixKeyType: 'EMAIL', pixKey: 'ana@email.com' }),
      });
    });

    it('não aprova duas vezes', async () => {
      const { useCase, pedidos, parceiros } = build();
      await useCase.solicitar('u1', pedido);
      await useCase.aprovar(pedidos[0].id, 'admin-1');

      const deNovo = await useCase.aprovar(pedidos[0].id, 'admin-2');

      expect(deNovo.isFail() && deNovo.error.kind).toBe('CONFLICT');
      expect(parceiros).toHaveLength(1);
    });

    it('não recusa o que já foi aprovado', async () => {
      const { useCase, pedidos } = build();
      await useCase.solicitar('u1', pedido);
      await useCase.aprovar(pedidos[0].id, 'admin-1');

      const recusa = await useCase.recusar(pedidos[0].id, 'admin-2', 'mudei de ideia');

      expect(recusa.isFail() && recusa.error.kind).toBe('CONFLICT');
      expect(pedidos[0].status).toBe('APPROVED');
    });

    it('pedido que não existe é 404', async () => {
      const { useCase } = build();
      const result = await useCase.aprovar('nao-existe', 'admin-1');
      expect(result.isFail() && result.error.kind).toBe('NOT_FOUND');
    });
  });

  describe('recusar', () => {
    it('fecha o pedido com o motivo e deixa pedir de novo', async () => {
      const { useCase, pedidos } = build();
      await useCase.solicitar('u1', pedido);

      const recusa = await useCase.recusar(pedidos[0].id, 'admin-1', 'Faltou o contrato');
      expect(recusa.isOk()).toBe(true);
      expect(pedidos[0]).toMatchObject({
        status: 'REJECTED',
        pendingUserId: null,
        decisionNote: 'Faltou o contrato',
      });

      const minha = await useCase.minha('u1');
      expect(minha.isOk() && minha.value.decisionNote).toBe('Faltou o contrato');

      const novo = await useCase.solicitar('u1', pedido);
      expect(novo.isOk() && novo.value.status).toBe('PENDING');
    });
  });
});
