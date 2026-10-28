import type { NarrativeInput } from '@contexts/genomics/domain/ports/narrative.provider';
import { bandFor } from '@contexts/genomics/domain/scoring/score-band';
import {
  compactRanges,
  MatrixNarrativeProvider,
} from '@contexts/genomics/infrastructure/narrative/matrix-narrative.provider';
import { PROFILES } from '@contexts/genomics/infrastructure/narrative/result-matrix';
import { TableNarrativeProvider } from '@contexts/genomics/infrastructure/narrative/table-narrative.provider';

/**
 * O resumo do laudo de Performance sai da matriz do cliente (GC-AJ-018).
 *
 * O caso de referência é o exemplo do próprio guia: Força 53, Resistência 72,
 * Recuperação 47, Lesão 28, Metabolismo 71, Neuroperformance 42. O guia escreve
 * o texto esperado; este teste confere peça por peça.
 */
describe('MatrixNarrativeProvider', () => {
  const provider = new MatrixNarrativeProvider(new TableNarrativeProvider());

  const category = (slug: string, score: number) => ({
    slug,
    name: slug,
    score,
    band: bandFor(score),
  });

  const performance = (scores: Record<string, number>): NarrativeInput => ({
    panelName: 'gene.code Performance',
    categories: Object.entries(scores).map(([slug, score]) => category(slug, score)),
    globalIndex: 60,
  });

  const guideExample = performance({
    forca_potencia: 53,
    resistencia_aerobica: 72,
    recuperacao_inflamacao: 47,
    risco_lesao: 28,
    metabolismo_composicao: 71,
    neuroperformance: 42,
  });

  it('monta o exemplo do guia: perfil intermediária × alta e os quatro moduladores', async () => {
    const result = await provider.generate(guideExample);
    const paragraphs = result.text.split('\n\n');

    expect(paragraphs[0]).toBe(PROFILES['intermediaria|alta']);
    expect(paragraphs[1]).toMatch(/^Os marcadores de Recuperação .* faixa intermediária/);
    expect(paragraphs[2]).toMatch(/^Os marcadores de Risco de Lesão .* faixa baixa/);
    expect(paragraphs[3]).toMatch(/^Os marcadores de Metabolismo .* faixa alta/);
    expect(paragraphs[4]).toMatch(/^Os marcadores de Neuroperformance .* faixa intermediária/);
    expect(paragraphs[5]).toBe('Referências: 1, 3, 5, 7–22, 26.');
    expect(paragraphs).toHaveLength(6);
  });

  it('identifica a procedência e devolve as citações completas', async () => {
    const result = await provider.generate(guideExample);

    expect(result.provider).toBe('matrix');
    expect(result.promptVersion).toBe('matriz-v1');
    expect(result.fallbackReason).toBeNull();
    expect(result.references?.map((reference) => reference.number)).toEqual([
      1, 3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 26,
    ]);
    expect(result.references?.[0]?.citation).toMatch(/^Webborn N/);
  });

  it('cobre os 9 perfis principais', async () => {
    const levels: Array<[string, number]> = [
      ['alta', 80],
      ['intermediaria', 50],
      ['baixa', 25],
    ];
    for (const [strengthLevel, strength] of levels) {
      for (const [enduranceLevel, endurance] of levels) {
        const result = await provider.generate(
          performance({ forca_potencia: strength, resistencia_aerobica: endurance }),
        );
        expect(result.text.split('\n\n')[0]).toBe(PROFILES[`${strengthLevel}|${enduranceLevel}`]);
      }
    }
  });

  it('não escreve sobre modulador que o laudo não tem', async () => {
    const result = await provider.generate(
      performance({ forca_potencia: 70, resistencia_aerobica: 70, risco_lesao: 50 }),
    );
    expect(result.text).not.toContain('Recuperação');
    expect(result.text).toContain('Risco de Lesão');
    expect(result.text).toMatch(/Referências: 1, 3, 5, 7–13, 16, 17, 26\.$/);
  });

  it('cai no texto de tabela quando o painel não tem matriz (Nutrigenética)', async () => {
    const result = await provider.generate({
      panelName: 'gene.code Nutrigenética',
      categories: [category('metabolismo_energetico', 60)],
      globalIndex: 58,
    });
    expect(result.provider).toBe('table');
    expect(result.fallbackReason).toBe('painel sem matriz de resultados');
  });

  it('compacta sequências de três ou mais números em intervalo', () => {
    expect(compactRanges([1, 3, 5, 7, 8, 9, 10])).toBe('1, 3, 5, 7–10');
    expect(compactRanges([14, 15])).toBe('14, 15');
    expect(compactRanges([])).toBe('');
  });
});
