import { LogisticsUseCase, validatePickupDate } from './logistics.use-case';

/** GC-AJ-041: a retirada só vale em dia útil, a partir de amanhã e até 10 dias. */
describe('validatePickupDate', () => {
  // Sexta, 30/10/2026, 15h em Brasília.
  const now = new Date('2026-10-30T18:00:00Z');

  it.each([
    ['2026-11-02', null],
    ['2026-11-09', null],
    ['2026-10-30', 'Escolha a partir de amanhã.'],
    ['2026-10-31', 'A retirada acontece de segunda a sexta.'],
    ['2026-11-01', 'A retirada acontece de segunda a sexta.'],
    ['2026-11-12', 'Escolha uma data nos próximos 10 dias.'],
    ['amanhã', 'Escolha uma data válida.'],
  ])('%s → %s', (date, expected) => {
    expect(validatePickupDate(date, now)).toBe(expected);
  });
});

describe('LogisticsUseCase com a DHL desligada (GC-N05-10)', () => {
  const config = { get: (key: string) => (key === 'SHIPPING_PROVIDER' ? 'manual' : undefined) };
  // Nenhuma chamada ao banco ou à transportadora pode acontecer: o bloqueio vem antes.
  const nothing = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('não deveria ser chamado');
      },
    },
  );
  const useCase = new LogisticsUseCase(
    nothing as never,
    nothing as never,
    nothing as never,
    config as never,
  );

  it('não emite etiqueta e diz como seguir', async () => {
    const result = await useCase.generateLabels('GC-2026-00001');
    expect(result.isFail()).toBe(true);
    expect(result.isFail() && result.error.message).toMatch(/informe o rastreio/);
  });

  it('não agenda retirada e aponta para a página de devolução', async () => {
    const result = await useCase.schedulePickup('GC-2026-00001', 'user-1', {
      date: '2026-11-10',
      window: 'MANHA',
    });
    expect(result.isFail()).toBe(true);
    expect(result.isFail() && result.error.message).toMatch(/página de devolução/);
  });
});
