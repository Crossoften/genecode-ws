import { validatePickupDate } from './logistics.use-case';

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
