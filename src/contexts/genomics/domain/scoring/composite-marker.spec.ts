import { HFE_RULE, MTHFR_RULE } from './composite-marker';

/**
 * Testes dos marcadores compostos.
 *
 * A penalidade por interação é a parte que erra em silêncio: se ela não for
 * aplicada, o escore continua num intervalo plausível e ninguém percebe olhando
 * o laudo. Por isso os casos abaixo verificam o valor exato, não só a ordem.
 */
describe('MTHFR — C677T + A1298C', () => {
  const evaluate = (c677t: string, a1298c: string): number | null =>
    MTHFR_RULE.evaluate({
      genotypes: new Map([
        ['rs1801133', c677t],
        ['rs1801131', a1298c],
      ]),
    });

  it('devolve null quando falta um dos genótipos', () => {
    expect(MTHFR_RULE.evaluate({ genotypes: new Map([['rs1801133', 'CC']]) })).toBeNull();
    expect(MTHFR_RULE.evaluate({ genotypes: new Map() })).toBeNull();
  });

  it('devolve null para genótipo não reconhecido', () => {
    expect(evaluate('XX', 'AA')).toBeNull();
  });

  it('pontua no máximo quando os dois são favoráveis', () => {
    // 100 × 0,55 + 100 × 0,45 = 100, sem penalidade
    expect(evaluate('CC', 'AA')).toBe(100);
  });

  it('aplica penalidade de 8 quando só um é desfavorável', () => {
    // 15 × 0,55 + 100 × 0,45 = 53,25 → −8
    expect(evaluate('TT', 'AA')).toBeCloseTo(45.25, 2);
    // 100 × 0,55 + 25 × 0,45 = 66,25 → −8
    expect(evaluate('CC', 'CC')).toBeCloseTo(58.25, 2);
  });

  it('aplica penalidade de 15 quando os dois são desfavoráveis', () => {
    // 15 × 0,55 + 25 × 0,45 = 19,5 → −15
    expect(evaluate('TT', 'CC')).toBeCloseTo(4.5, 2);
  });

  it('nunca devolve valor negativo', () => {
    for (const [a, b] of [
      ['TT', 'CC'],
      ['TT', 'AC'],
      ['CT', 'CC'],
    ] as const) {
      expect(evaluate(a, b)!).toBeGreaterThanOrEqual(0);
    }
  });

  it('trata a ordem do heterozigoto como equivalente', () => {
    expect(evaluate('CT', 'AC')).toBe(evaluate('TC', 'CA'));
  });

  /**
   * Fixa a decisão de polaridade.
   *
   * A planilha e o Python discordam sobre o C677T, e adotei a planilha: TT
   * reduz a atividade da MTHFR para cerca de 30% do normal, então é o genótipo
   * desfavorável. Se alguém reverter isso sem discutir, este teste quebra.
   */
  it('trata CC como favorável e TT como desfavorável no C677T', () => {
    expect(evaluate('CC', 'AA')!).toBeGreaterThan(evaluate('TT', 'AA')!);
  });
});

describe('HFE — C282Y + H63D', () => {
  const evaluate = (c282y: string, h63d: string): number | null =>
    HFE_RULE.evaluate({
      genotypes: new Map([
        ['rs1800562', c282y],
        ['rs1799945', h63d],
      ]),
    });

  it('pontua no máximo quando os dois são favoráveis', () => {
    expect(evaluate('GG', 'CC')).toBe(100);
  });

  it('penaliza o heterozigoto composto, que é a combinação de relevância clínica', () => {
    // 40 × 0,6 + 50 × 0,4 = 44 → −20
    expect(evaluate('AG', 'CG')).toBeCloseTo(24, 2);
  });

  it('penaliza o homozigoto C282Y', () => {
    // 0 × 0,6 + 100 × 0,4 = 40 → −10
    expect(evaluate('AA', 'CC')).toBeCloseTo(30, 2);
  });

  it('não penaliza quando só um deles é heterozigoto', () => {
    // 40 × 0,6 + 100 × 0,4 = 64, sem penalidade
    expect(evaluate('AG', 'CC')).toBeCloseTo(64, 2);
  });

  it('pune mais o heterozigoto composto do que cada heterozigose isolada', () => {
    const composto = evaluate('AG', 'CG')!;
    expect(composto).toBeLessThan(evaluate('AG', 'CC')!);
    expect(composto).toBeLessThan(evaluate('GG', 'CG')!);
  });

  it('nunca devolve valor negativo', () => {
    expect(evaluate('AA', 'GG')!).toBeGreaterThanOrEqual(0);
  });
});
