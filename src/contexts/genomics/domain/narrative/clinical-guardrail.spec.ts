import {
  inspectCategoryScope,
  inspectNarrative,
} from '@contexts/genomics/domain/narrative/clinical-guardrail';

/**
 * O limite clínico do texto gerado.
 *
 * O Dr. Câmara resumiu a exigência em 16/07: *"eu vou até esse ponto, mas não
 * passo daqui"*. Estes testes são a definição operacional de "daqui".
 *
 * A premissa que justifica o guardrail existir, além do prompt: instrução em
 * prompt é probabilística. Para um documento de saúde emitido em nome de um
 * laboratório de 36 anos, "o modelo quase sempre obedece" não é garantia
 * suficiente.
 */
describe('Guardrail clínico do texto do laudo', () => {
  const VALID = [
    'Seu índice global no painel de Performance é 62,4, numa escala de 20 a 90 comparada à',
    'população de referência. Seus pontos mais favoráveis são Força e Potência. Merecem mais',
    'atenção Recuperação Muscular e Metabolismo Energético: escores nesta faixa não indicam',
    'problema de saúde, apontam onde seus hábitos e seu treino tendem a fazer mais diferença.',
    'A leitura junto de um profissional é o que transforma estes números em decisão prática.',
  ].join(' ');

  it('aprova um texto dentro do limite', () => {
    expect(inspectNarrative(VALID).approved).toBe(true);
  });

  describe('recusa o que caracteriza ato clínico', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['diagnóstico', `${VALID} O diagnóstico sugerido é de intolerância à lactose.`],
      ['prescrição', `${VALID} Prescrevemos creatina para o seu perfil.`],
      ['dosagem', `${VALID} Considere 5000 UI de vitamina D.`],
      ['medicamento', `${VALID} Converse sobre o medicamento indicado.`],
      ['afirmação de doença', `${VALID} Você tem uma doença metabólica hereditária.`],
      ['predição de doença', `${VALID} Você irá desenvolver resistência à insulina.`],
      ['risco numérico de doença', `${VALID} Seu risco de 40% exige acompanhamento.`],
      ['tratamento', `${VALID} Este é o tratamento para a doença identificada.`],
      [
        'substituição de consulta',
        `${VALID} Este laudo substitui a consulta com seu médico.`,
      ],
    ];

    it.each(cases)('barra %s', (reason, text) => {
      const verdict = inspectNarrative(text);
      expect(verdict.approved).toBe(false);
      expect(verdict.violations).toContain(reason);
    });
  });

  it('recusa resposta curta demais, que é evasiva ou erro', () => {
    expect(inspectNarrative('Não posso ajudar com isso.').approved).toBe(false);
  });

  it('recusa texto longo demais, que deixou de ser resumo', () => {
    expect(inspectNarrative('Seu perfil é equilibrado. '.repeat(200)).approved).toBe(false);
  });

  /**
   * A recusa é do texto inteiro, não da frase.
   *
   * Editar a saída para remover a frase proibida deixaria o resto do parágrafo
   * argumentando em direção a ela — o leitor receberia a conclusão sem a
   * premissa. Por isso o veredito é binário e o provedor descarta tudo.
   */
  it('acumula todos os motivos, para a auditoria saber o que aconteceu', () => {
    const verdict = inspectNarrative(`${VALID} Prescrevemos 500 mg do medicamento indicado.`);
    expect(verdict.violations.length).toBeGreaterThan(1);
  });
});

/**
 * A alucinação que mais preocupa neste domínio não é o texto ficar ruim — é ele
 * citar uma categoria que o painel do paciente não tem.
 */
describe('Escopo de categorias', () => {
  const TODAS = [
    'Força e Potência',
    'Resistência Aeróbica',
    'Recuperação Muscular',
    'Metabolismo de Lipídios',
  ];

  it('aprova texto que só cita categorias do próprio laudo', () => {
    const texto = 'Força e Potência ficou acima da média, e Resistência Aeróbica na faixa média.';
    const verdict = inspectCategoryScope(
      texto,
      ['Força e Potência', 'Resistência Aeróbica'],
      TODAS,
    );
    expect(verdict.approved).toBe(true);
  });

  it('barra categoria que existe na plataforma mas não neste laudo', () => {
    const texto = 'Força e Potência foi bem, mas seu Metabolismo de Lipídios preocupa.';
    const verdict = inspectCategoryScope(texto, ['Força e Potência'], TODAS);

    expect(verdict.approved).toBe(false);
    expect(verdict.violations).toEqual(['categoria fora do laudo: Metabolismo de Lipídios']);
  });

  it('compara sem acento e sem caixa, porque o modelo escreve como quiser', () => {
    const verdict = inspectCategoryScope(
      'sua RESISTENCIA AEROBICA está boa',
      ['Força e Potência'],
      TODAS,
    );
    expect(verdict.approved).toBe(false);
  });

  it('permite omitir categorias — o texto é resumo, não inventário', () => {
    const verdict = inspectCategoryScope('Força e Potência ficou acima da média.', TODAS, TODAS);
    expect(verdict.approved).toBe(true);
  });
});
