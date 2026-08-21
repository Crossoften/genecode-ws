import {
  qualityToEnvironmental,
  scoreCategory,
  strategyForPanel,
  type WeightedQuestion,
} from './environmental-score';

/**
 * O núcleo do escore ambiental: respostas → qualidade ponderada → escore na
 * escala da estratégia → escore ajustado. Os números conferidos aqui são os
 * mesmos que o profissional vê no laudo, então não podem mudar por acidente.
 */
describe('environmental-score', () => {
  const q = (id: string, weight: number, points: Record<string, number>): WeightedQuestion => ({
    id,
    categorySlug: 'grupo',
    weight,
    optionPoints: new Map(Object.entries(points)),
  });

  describe('scoreCategory', () => {
    it('devolve null quando nenhuma pergunta da categoria foi respondida', () => {
      const questions = [q('q1', 1, { a: 0, b: 100 })];
      expect(scoreCategory('performance', 50, questions, new Map())).toBeNull();
    });

    it('performance: melhor hábito puxa o ajustado para cima (aditivo 30/70)', () => {
      const questions = [q('q1', 1, { pior: 0, melhor: 100 })];
      const answers = new Map([['q1', 'melhor']]);
      const result = scoreCategory('performance', 50, questions, answers);
      // quality=1 → env=90 → adjusted = round1(50*0.3 + 90*0.7) = 78
      expect(result).toEqual({ environmental: 90, adjusted: 78 });
    });

    it('performance: pior hábito rebaixa o ajustado', () => {
      const questions = [q('q1', 1, { pior: 0, melhor: 100 })];
      const answers = new Map([['q1', 'pior']]);
      const result = scoreCategory('performance', 50, questions, answers);
      // quality=0 → env=20 → adjusted = round1(15 + 14) = 29
      expect(result).toEqual({ environmental: 20, adjusted: 29 });
    });

    it('nutrigenética: qualidade vira modificador multiplicativo 0,6–1,4', () => {
      const questions = [q('q1', 1, { pior: 0, melhor: 100 })];
      const melhor = scoreCategory('nutrigenetics', 50, questions, new Map([['q1', 'melhor']]));
      const pior = scoreCategory('nutrigenetics', 50, questions, new Map([['q1', 'pior']]));
      // melhor: modifier=1.4 → 50*1.4=70 ; pior: modifier=0.6 → 50*0.6=30
      expect(melhor).toEqual({ environmental: 1.4, adjusted: 70 });
      expect(pior).toEqual({ environmental: 0.6, adjusted: 30 });
    });

    it('pondera as respostas pelo peso da pergunta', () => {
      // Q1 (peso 1) pior=0 ; Q2 (peso 3) melhor=100 → quality = 3/4 = 0.75
      const questions = [q('q1', 1, { pior: 0 }), q('q2', 3, { melhor: 100 })];
      const answers = new Map([
        ['q1', 'pior'],
        ['q2', 'melhor'],
      ]);
      const result = scoreCategory('performance', 50, questions, answers);
      // env = 20 + 0.75*70 = 72.5 → adjusted = round1(15 + 50.75) = 65.8
      expect(result?.environmental).toBe(72.5);
      expect(result?.adjusted).toBe(65.8);
    });

    it('ignora perguntas sem resposta e opção inexistente', () => {
      const questions = [q('q1', 1, { melhor: 100 }), q('q2', 5, { melhor: 100 })];
      // q2 aponta para uma opção que não existe no mapa → é ignorada
      const answers = new Map([
        ['q1', 'melhor'],
        ['q2', 'fantasma'],
      ]);
      const result = scoreCategory('performance', 40, questions, answers);
      // só q1 conta → quality=1 → env=90 → adjusted = round1(12 + 63) = 75
      expect(result).toEqual({ environmental: 90, adjusted: 75 });
    });
  });

  describe('qualityToEnvironmental', () => {
    it('mapeia performance para 20–90 e nutrigenética para 0,6–1,4', () => {
      expect(qualityToEnvironmental('performance', 0)).toBe(20);
      expect(qualityToEnvironmental('performance', 1)).toBe(90);
      expect(qualityToEnvironmental('nutrigenetics', 0)).toBe(0.6);
      expect(qualityToEnvironmental('nutrigenetics', 1)).toBe(1.4);
    });
  });

  describe('strategyForPanel', () => {
    it('sem entrevista (ambiental null) devolve o genético intocado', () => {
      expect(strategyForPanel('performance').combine(63, null)).toBe(63);
      expect(strategyForPanel('nutrigenetics').combine(63, null)).toBe(63);
    });
  });
});
