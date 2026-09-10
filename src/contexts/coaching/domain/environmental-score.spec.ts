import {
  qualityToEnvironmental,
  scoreCategory,
  strategyForPanel,
  type WeightedQuestion,
} from './environmental-score';

/**
 * O núcleo do escore ambiental: respostas → qualidade ponderada → escore 0–100
 * → escore ajustado. Os números conferidos aqui são os mesmos que o profissional
 * **e o paciente** veem no laudo (decisão 24 do André em 09/09), então não podem
 * mudar por acidente.
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
      // quality=1 → env=100 → adjusted = round1(50*0.3 + 100*0.7) = 85
      expect(result).toEqual({ environmental: 100, adjusted: 85 });
    });

    it('performance: pior hábito zera o ambiental e rebaixa o ajustado ao genético×0,3', () => {
      const questions = [q('q1', 1, { pior: 0, melhor: 100 })];
      const answers = new Map([['q1', 'pior']]);
      const result = scoreCategory('performance', 50, questions, answers);
      // quality=0 → env=0 → adjusted = round1(15 + 0) = 15
      expect(result).toEqual({ environmental: 0, adjusted: 15 });
    });

    it('bloco de 4 perguntas pontuado por posição da opção (§3.3/§3.4 da spec)', () => {
      // As 4 perguntas do bloco pesam igual (25%) e a resposta vale pela posição:
      // 1ª=100, 2ª=66,7, 3ª=33,3, 4ª=0. Escolhendo uma de cada posição, o
      // ambiental do bloco é a média: (100 + 66,7 + 33,3 + 0) / 4 = 50.
      const questions = [
        q('q1', 1, { escolhida: 100 }),
        q('q2', 1, { escolhida: 66.7 }),
        q('q3', 1, { escolhida: 33.3 }),
        q('q4', 1, { escolhida: 0 }),
      ];
      const answers = new Map(questions.map((question) => [question.id, 'escolhida']));
      const result = scoreCategory('performance', 60, questions, answers);
      // env=50 → adjusted = round1(60*0.3 + 50*0.7) = 53
      expect(result).toEqual({ environmental: 50, adjusted: 53 });
    });

    it('nutrigenética: grava o ambiental 0–100 e aplica o modificador 0,6–1,4 por dentro', () => {
      const questions = [q('q1', 1, { pior: 0, melhor: 100 })];
      const melhor = scoreCategory('nutrigenetics', 50, questions, new Map([['q1', 'melhor']]));
      const pior = scoreCategory('nutrigenetics', 50, questions, new Map([['q1', 'pior']]));
      // melhor: env=100 → modifier=1.4 → 50*1.4=70 ; pior: env=0 → modifier=0.6 → 30
      expect(melhor).toEqual({ environmental: 100, adjusted: 70 });
      expect(pior).toEqual({ environmental: 0, adjusted: 30 });
    });

    it('pondera as respostas pelo peso da pergunta', () => {
      // Q1 (peso 1) pior=0 ; Q2 (peso 3) melhor=100 → quality = 3/4 = 0.75
      const questions = [q('q1', 1, { pior: 0 }), q('q2', 3, { melhor: 100 })];
      const answers = new Map([
        ['q1', 'pior'],
        ['q2', 'melhor'],
      ]);
      const result = scoreCategory('performance', 50, questions, answers);
      // env = 0.75*100 = 75 → adjusted = round1(15 + 52.5) = 67.5
      expect(result?.environmental).toBe(75);
      expect(result?.adjusted).toBe(67.5);
    });

    it('ignora perguntas sem resposta e opção inexistente', () => {
      const questions = [q('q1', 1, { melhor: 100 }), q('q2', 5, { melhor: 100 })];
      // q2 aponta para uma opção que não existe no mapa → é ignorada
      const answers = new Map([
        ['q1', 'melhor'],
        ['q2', 'fantasma'],
      ]);
      const result = scoreCategory('performance', 40, questions, answers);
      // só q1 conta → quality=1 → env=100 → adjusted = round1(12 + 70) = 82
      expect(result).toEqual({ environmental: 100, adjusted: 82 });
    });
  });

  describe('qualityToEnvironmental', () => {
    it('mapeia a qualidade para 0–100, a escala única dos dois painéis', () => {
      expect(qualityToEnvironmental(0)).toBe(0);
      expect(qualityToEnvironmental(0.5)).toBe(50);
      expect(qualityToEnvironmental(1)).toBe(100);
    });
  });

  describe('strategyForPanel', () => {
    it('sem entrevista (ambiental null) devolve o genético intocado', () => {
      expect(strategyForPanel('performance').combine(63, null)).toBe(63);
      expect(strategyForPanel('nutrigenetics').combine(63, null)).toBe(63);
    });
  });
});
