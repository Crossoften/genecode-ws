import { inspectNarrative } from '@contexts/genomics/domain/narrative/clinical-guardrail';
import type { NarrativeInput } from '@contexts/genomics/domain/ports/narrative.provider';
import { TableNarrativeProvider } from '@contexts/genomics/infrastructure/narrative/table-narrative.provider';

/**
 * O gerador de tabela é o **padrão** da plataforma, não um plano B degradado.
 *
 * Ele também é o destino da IA quando o guardrail recusa a saída — o que
 * significa que ele carrega uma obrigação incomum: precisa passar no próprio
 * guardrail, sempre. Um fallback que fosse barrado pelo mesmo filtro deixaria o
 * laudo sem texto nenhum.
 */
describe('TableNarrativeProvider', () => {
  const provider = new TableNarrativeProvider();

  const input = (categories: NarrativeInput['categories'], globalIndex: number | null = 62.4) => ({
    panelName: 'Performance Esportiva',
    categories,
    globalIndex,
  });

  it('cita o índice global e a escala', async () => {
    const result = await provider.generate(
      input([{ name: 'Força e Potência', score: 78.2, band: 'FAVORAVEL' }]),
    );

    expect(result.text).toContain('62,4');
    expect(result.text).toContain('20 a 90');
    expect(result.provider).toBe('table');
    expect(result.model).toBeNull();
  });

  it('omite o índice global quando o painel não tem um', async () => {
    const result = await provider.generate(
      input([{ name: 'Metabolismo de Lipídios', score: 41.0, band: 'ATENCAO' }], null),
    );

    expect(result.text).toContain('resumo do seu painel');
    expect(result.text).not.toContain('índice global');
  });

  /**
   * Escore baixo não é doença.
   *
   * É a única leitura que o cliente enfatizou em todas as reuniões, e a que um
   * texto automático mais facilmente estraga.
   */
  it('enquadra escore baixo como onde o hábito rende mais, nunca como problema', async () => {
    const result = await provider.generate(
      input([{ name: 'Recuperação Muscular', score: 28.0, band: 'PRIORIDADE' }]),
    );

    expect(result.text).toContain('não indicam problema de saúde');
    expect(result.text).toMatch(/hábitos e seu treino/);
  });

  it('sempre encerra apontando para um profissional', async () => {
    const result = await provider.generate(
      input([{ name: 'Força e Potência', score: 78.2, band: 'FAVORAVEL' }]),
    );
    expect(result.text).toMatch(/profissional de saúde ou de educação física/);
  });

  it('descreve perfil equilibrado quando não há extremos', async () => {
    const result = await provider.generate(
      input([
        { name: 'Força e Potência', score: 60.0, band: 'MODERADO' },
        { name: 'Resistência Aeróbica', score: 58.0, band: 'MODERADO' },
      ]),
    );
    expect(result.text).toContain('perfil equilibrado');
  });

  it('lista no máximo três categorias por lado, para o texto não virar tabela', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      name: `Categoria ${index}`,
      score: 80 - index,
      band: 'FAVORAVEL',
    }));

    const result = await provider.generate(input(many));
    const mentioned = many.filter((category) => result.text.includes(category.name));
    expect(mentioned).toHaveLength(3);
  });

  /**
   * A invariante que sustenta o fallback inteiro.
   */
  it('passa no guardrail clínico em qualquer combinação de faixas', async () => {
    const bands = ['FAVORAVEL', 'MODERADO', 'ATENCAO', 'PRIORIDADE'] as const;

    for (const band of bands) {
      for (const globalIndex of [null, 20, 55, 90]) {
        const result = await provider.generate(
          input(
            [
              { name: 'Força e Potência', score: 78.2, band },
              { name: 'Recuperação Muscular', score: 31.5, band },
            ],
            globalIndex,
          ),
        );

        const verdict = inspectNarrative(result.text);
        expect({ band, globalIndex, violations: verdict.violations }).toEqual({
          band,
          globalIndex,
          violations: [],
        });
      }
    }
  });

  /**
   * Reprodutibilidade é o motivo declarado da decisão L4 — o mesmo laudo não
   * pode dizer coisas diferentes em dias diferentes.
   */
  it('é determinístico: mesma entrada, mesmo texto', async () => {
    const argument = input([
      { name: 'Força e Potência', score: 78.2, band: 'FAVORAVEL' },
      { name: 'Recuperação Muscular', score: 31.5, band: 'PRIORIDADE' },
    ]);

    const first = await provider.generate(argument);
    const second = await provider.generate(argument);
    expect(first.text).toBe(second.text);
  });
});
