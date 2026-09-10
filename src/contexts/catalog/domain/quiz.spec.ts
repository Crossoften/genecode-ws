import {
  affinityFor,
  QUIZ_CUTOFF,
  QUIZ_MAX_PER_BLOCK,
  QUIZ_OPTIONS,
  QUIZ_STATEMENTS,
  resolveQuiz,
  scoreBlocks,
  type QuizBlock,
} from './quiz';

/**
 * Monta um envio completo: `performance` e `nutrigenetica` são os pontos
 * desejados em cada bloco, distribuídos nas seis afirmações do bloco.
 */
function answersScoring(totals: Record<QuizBlock, number>): ReadonlyMap<string, string> {
  const remaining = { ...totals };
  const answers = new Map<string, string>();

  for (const statement of QUIZ_STATEMENTS) {
    const points = Math.min(2, Math.max(0, remaining[statement.block]));
    remaining[statement.block] -= points;
    answers.set(statement.id, QUIZ_OPTIONS[points]!.id);
  }

  return answers;
}

describe('Quiz — estrutura das afirmações', () => {
  it('tem 12 afirmações em dois blocos de 6, na ordem do documento', () => {
    expect(QUIZ_STATEMENTS).toHaveLength(12);
    expect(QUIZ_STATEMENTS.slice(0, 6).map((s) => s.block)).toEqual(Array(6).fill('performance'));
    expect(QUIZ_STATEMENTS.slice(6).map((s) => s.block)).toEqual(Array(6).fill('nutrigenetica'));
  });

  it('abre cada bloco com a afirmação do documento', () => {
    expect(QUIZ_STATEMENTS[0]!.prompt).toBe(
      'Você pratica exercícios físicos ou algum esporte regularmente?',
    );
    expect(QUIZ_STATEMENTS[6]!.prompt).toBe(
      'Você tem dificuldade em controlar o peso ou em manter os resultados de uma dieta?',
    );
  });

  it('oferece as mesmas três opções em todas, valendo 0, 1 e 2', () => {
    expect(QUIZ_OPTIONS.map((option) => [option.label, option.score])).toEqual([
      ['Não', 0],
      ['Um pouco', 1],
      ['Sim', 2],
    ]);
    for (const statement of QUIZ_STATEMENTS) {
      expect(statement.options).toBe(QUIZ_OPTIONS);
    }
  });

  it('não repete id de afirmação', () => {
    const ids = new Set(QUIZ_STATEMENTS.map((statement) => statement.id));
    expect(ids.size).toBe(QUIZ_STATEMENTS.length);
  });
});

describe('Quiz — pontuação por bloco', () => {
  it('marcar "Sim" em tudo dá 12 em cada bloco', () => {
    expect(scoreBlocks(answersScoring({ performance: 12, nutrigenetica: 12 }))).toEqual({
      performance: QUIZ_MAX_PER_BLOCK,
      nutrigenetica: QUIZ_MAX_PER_BLOCK,
    });
  });

  it('marcar "Não" em tudo dá zero em cada bloco', () => {
    expect(scoreBlocks(answersScoring({ performance: 0, nutrigenetica: 0 }))).toEqual({
      performance: 0,
      nutrigenetica: 0,
    });
  });

  it('soma cada resposta no bloco da própria afirmação', () => {
    expect(scoreBlocks(answersScoring({ performance: 9, nutrigenetica: 3 }))).toEqual({
      performance: 9,
      nutrigenetica: 3,
    });
  });

  it('ignora resposta com id desconhecido em vez de quebrar', () => {
    const answers = new Map([
      ['perf-1', 'sim'],
      ['perf-99', 'sim'],
      ['nutri-1', 'talvez'],
    ]);

    expect(scoreBlocks(answers)).toEqual({ performance: 2, nutrigenetica: 0 });
  });
});

describe('Quiz — regra de quadrante', () => {
  it('só performance acima do corte recomenda o painel de performance', () => {
    const outcome = resolveQuiz(answersScoring({ performance: QUIZ_CUTOFF, nutrigenetica: 6 }));

    expect(outcome.productSlug).toBe('performance');
    expect(outcome.guidance).toBe('direta');
  });

  it('só nutrigenética acima do corte recomenda o painel de nutrigenética', () => {
    const outcome = resolveQuiz(answersScoring({ performance: 6, nutrigenetica: QUIZ_CUTOFF }));

    expect(outcome.productSlug).toBe('nutrigenetica');
    expect(outcome.guidance).toBe('direta');
  });

  it('os dois acima do corte recomendam o painel completo', () => {
    const outcome = resolveQuiz(answersScoring({ performance: 7, nutrigenetica: 8 }));

    expect(outcome.productSlug).toBe('premium');
    expect(outcome.guidance).toBe('direta');
  });

  it('7 é corte inclusivo: 6 ainda é indefinido', () => {
    expect(resolveQuiz(answersScoring({ performance: 6, nutrigenetica: 2 })).guidance).toBe(
      'consulte-treinador',
    );
    expect(resolveQuiz(answersScoring({ performance: 7, nutrigenetica: 2 })).guidance).toBe(
      'direta',
    );
  });
});

/**
 * O quadrante indefinido é o ponto em que o documento e o cliente se
 * contradizem. A terceira via de 09/09 é o que estes testes travam: continua
 * saindo produto, e sai também a orientação.
 */
describe('Quiz — quadrante indefinido', () => {
  it('recomenda o painel do bloco de maior pontuação e pede o treinador', () => {
    const outcome = resolveQuiz(answersScoring({ performance: 5, nutrigenetica: 2 }));

    expect(outcome.productSlug).toBe('performance');
    expect(outcome.guidance).toBe('consulte-treinador');
  });

  it('empate abaixo do corte cai no painel completo', () => {
    const outcome = resolveQuiz(answersScoring({ performance: 4, nutrigenetica: 4 }));

    expect(outcome.productSlug).toBe('premium');
    expect(outcome.guidance).toBe('consulte-treinador');
  });

  it('nunca deixa de recomendar, nem com tudo em "Não"', () => {
    const outcome = resolveQuiz(answersScoring({ performance: 0, nutrigenetica: 0 }));

    expect(outcome.productSlug).toBe('premium');
    expect(outcome.guidance).toBe('consulte-treinador');
  });

  it('nenhuma das 169 combinações de pontuação fica sem produto', () => {
    for (let performance = 0; performance <= QUIZ_MAX_PER_BLOCK; performance += 1) {
      for (let nutrigenetica = 0; nutrigenetica <= QUIZ_MAX_PER_BLOCK; nutrigenetica += 1) {
        const outcome = resolveQuiz(answersScoring({ performance, nutrigenetica }));
        expect(outcome.productSlug).toBeTruthy();
      }
    }
  });
});

describe('Quiz — aderência', () => {
  it('mede o painel pelo que ele cobre das respostas', () => {
    const blocks = { performance: 12, nutrigenetica: 6 };

    expect(affinityFor('performance', blocks)).toBe(100);
    expect(affinityFor('nutrigenetica', blocks)).toBe(50);
    expect(affinityFor('premium', blocks)).toBe(75);
  });
});
