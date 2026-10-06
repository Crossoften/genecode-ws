import { EmitirKitsUseCase } from './emitir-kits.use-case';

/**
 * A emissão deixou de inventar código em 06/10 e passou a queimar da lista da
 * Genoa. Estes testes guardam o que importa nessa troca: nunca emitir um número
 * que não esteja na lista, nunca emitir o mesmo duas vezes, e nunca imprimir um
 * código que o validador recusaria.
 */
describe('EmitirKitsUseCase', () => {
  /** Pool de mentira, com o comportamento que o caso de uso espera do banco. */
  function montarPrisma(disponiveis: { sequencial: number; code: string }[]) {
    const queimados: number[] = [];
    const kitsCriados: { code: string; batchId: string }[] = [];
    const prisma = {
      kitBatch: { findUnique: jest.fn().mockResolvedValue(null) },
      activationCode: {
        count: jest.fn().mockImplementation(async () => disponiveis.length - queimados.length),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: async (_strings: unknown, quantidade: number) =>
            disponiveis.filter((c) => !queimados.includes(c.sequencial)).slice(0, quantidade),
          kitBatch: { create: async () => ({ id: 'lote-1', reference: 'LOTE' }) },
          kit: {
            createMany: async ({ data }: { data: typeof kitsCriados }) => {
              kitsCriados.push(...data);
            },
          },
          activationCode: {
            updateMany: async ({ where }: { where: { sequencial: { in: number[] } } }) => {
              queimados.push(...where.sequencial.in);
            },
          },
        }),
      ),
    };
    return { prisma, queimados, kitsCriados };
  }

  const LISTA = [
    { sequencial: 1, code: '557459-54' },
    { sequencial: 2, code: '618737-48' },
    { sequencial: 3, code: '728996-03' },
  ];

  it('emite os primeiros da lista, na ordem do sequencial', async () => {
    // É a ordem em que a Genoa imprime. Banco e papel contam a mesma história.
    const { prisma, queimados, kitsCriados } = montarPrisma(LISTA);
    const caso = new EmitirKitsUseCase(prisma as never);

    const r = await caso.execute(2, 'LOTE-01');

    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.sample).toEqual(['557459-54', '618737-48']);
      expect(r.value.sequencialInicial).toBe(1);
      expect(r.value.sequencialFinal).toBe(2);
      expect(r.value.restantes).toBe(1);
    }
    expect(kitsCriados.map((k) => k.code)).toEqual(['557459-54', '618737-48']);
    expect(queimados).toEqual([1, 2]);
  });

  it('nunca entrega o mesmo código duas vezes', async () => {
    const { prisma, kitsCriados } = montarPrisma(LISTA);
    const caso = new EmitirKitsUseCase(prisma as never);

    await caso.execute(2, 'LOTE-01');
    await caso.execute(1, 'LOTE-02');

    expect(kitsCriados.map((k) => k.code)).toEqual(['557459-54', '618737-48', '728996-03']);
    expect(new Set(kitsCriados.map((k) => k.code)).size).toBe(3);
  });

  it('recusa quando a lista não foi importada', async () => {
    const { prisma } = montarPrisma([]);
    const caso = new EmitirKitsUseCase(prisma as never);

    const r = await caso.execute(1, 'LOTE-01');

    expect(r.isFail()).toBe(true);
    if (r.isFail()) expect(r.error.message).toMatch(/não foi importada|se esgotou/);
  });

  it('recusa quando a lista tem menos códigos do que o lote pede', async () => {
    // Imprimir meio lote seria pior: ninguém saberia quais etiquetas saíram.
    const { prisma, kitsCriados } = montarPrisma(LISTA);
    const caso = new EmitirKitsUseCase(prisma as never);

    const r = await caso.execute(10, 'LOTE-01');

    expect(r.isFail()).toBe(true);
    if (r.isFail()) expect(r.error.message).toMatch(/3 código\(s\) disponíveis/);
    expect(kitsCriados).toHaveLength(0);
  });

  it('recusa referência de lote repetida', async () => {
    const { prisma } = montarPrisma(LISTA);
    prisma.kitBatch.findUnique.mockResolvedValue({ id: 'ja-existe' });
    const caso = new EmitirKitsUseCase(prisma as never);

    const r = await caso.execute(1, 'LOTE-01');

    expect(r.isFail()).toBe(true);
    if (r.isFail()) expect(r.error.message).toMatch(/Já existe um lote/);
  });

  it('recusa quantidade fora da faixa', async () => {
    const { prisma } = montarPrisma(LISTA);
    const caso = new EmitirKitsUseCase(prisma as never);

    for (const quantidade of [0, -1, 5_001, 1.5]) {
      const r = await caso.execute(quantidade, 'LOTE-01');
      expect(r.isFail()).toBe(true);
    }
  });
});
