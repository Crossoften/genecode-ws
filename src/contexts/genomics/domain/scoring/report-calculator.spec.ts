import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GenotypeNormalizer } from './genotype-normalizer';
import {
  ReportCalculator,
  type CategoryDefinition,
  type ModalityDefinition,
  type PanelDefinition,
} from './report-calculator';
import { bandFor, ScoreBand } from './score-band';

/**
 * Contraprova do motor de cálculo.
 *
 * Este é o teste que importa nesta onda. O método foi proposto pelo próprio
 * Dr. Câmara na reunião de 16/07: *"vocês podem passar o CSV no nosso back end,
 * que vai devolver uma lista, e comparar com os dados que vocês usam hoje"*.
 *
 * Roda o motor em TypeScript sobre os 80 pacientes reais e compara número a
 * número com a saída do algoritmo Python original. Sem isso não há como afirmar
 * que a portabilidade foi fiel — e num laudo de saúde, "parece certo" não basta.
 *
 * A saída de referência foi gerada por `scripts/export-reference-output.py`,
 * executando o `Esporte_indices.py` sem alteração alguma, exceto os pesos de
 * Neuroperformance corrigidos conforme a decisão B2.
 */
describe('ReportCalculator — contraprova contra o algoritmo original', () => {
  const DATA = join(__dirname, '__fixtures__');
  const panelJson = JSON.parse(
    readFileSync(join(__dirname, '../../../../../prisma/seeds/data/panel-performance.json'), 'utf8'),
  ) as PanelJsonShape;
  const modalityCurves = JSON.parse(
    readFileSync(
      join(__dirname, '../../../../../prisma/seeds/data/modality-percentiles-performance.json'),
      'utf8',
    ),
  ) as Record<string, { rawScore: number; percentile: number }[]>;

  const inputs = JSON.parse(readFileSync(join(DATA, 'patients-input.json'), 'utf8')) as Record<
    string,
    Record<string, string>
  >;
  const expected = JSON.parse(readFileSync(join(DATA, 'patients-expected.json'), 'utf8')) as Record<
    string,
    { categories: Record<string, number>; modalities: Record<string, number> }
  >;

  const calculator = new ReportCalculator(buildPanel(panelJson, modalityCurves));
  const patientIds = Object.keys(inputs);

  it('processa os 80 pacientes do arquivo de teste do laboratório', () => {
    expect(patientIds).toHaveLength(80);
  });

  describe.each(patientIds)('paciente %s', (patientId) => {
    const genotypes = new Map(Object.entries(inputs[patientId]!));
    const result = calculator.calculate(genotypes);
    const reference = expected[patientId]!;

    it('não rejeita nenhum genótipo e não deixa marcador faltando', () => {
      expect(result.rejectedMarkers).toEqual([]);
      expect(result.missingMarkers).toEqual([]);
    });

    it('reproduz os 6 escores por categoria', () => {
      for (const [slug, expectedScore] of Object.entries(reference.categories)) {
        const actual = result.categories.find((c) => c.slug === slug);
        expect(actual).toBeDefined();
        // Tolerância de 0,1: é a casa decimal em que ambos arredondam, então
        // qualquer diferença maior é divergência real de fórmula, não de ponto
        // flutuante.
        expect(actual!.normalizedScore).toBeCloseTo(expectedScore, 1);
      }
    });

    it('reproduz o índice bruto das 31 modalidades', () => {
      for (const [slug, expectedIndex] of Object.entries(reference.modalities)) {
        const actual = result.modalities.find((m) => m.slug === slug);
        expect(actual).toBeDefined();
        expect(actual!.rawIndex).toBeCloseTo(expectedIndex, 1);
      }
    });
  });

  describe('faixas de classificação', () => {
    it.each([
      [90, ScoreBand.FAVORAVEL],
      [73, ScoreBand.FAVORAVEL],
      [72.9, ScoreBand.MODERADO],
      [55, ScoreBand.MODERADO],
      [54.9, ScoreBand.ATENCAO],
      [38, ScoreBand.ATENCAO],
      [37.9, ScoreBand.PRIORIDADE],
      [20, ScoreBand.PRIORIDADE],
    ])('escore %s cai em %s', (score, band) => {
      expect(bandFor(score)).toBe(band);
    });
  });

  describe('renormalização dos índices compostos', () => {
    it('espalha o Índice Global por toda a escala, em vez de comprimi-lo na mediana', () => {
      const globals = patientIds.map((id) => {
        const result = calculator.calculate(new Map(Object.entries(inputs[id]!)));
        return result.modalities.find((m) => m.isGlobal)!;
      });

      const raw = globals.map((g) => g.rawIndex);
      const normalized = globals.map((g) => g.normalizedIndex);

      const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);

      // O índice bruto é média de 6 categorias e regride à mediana; o
      // normalizado devolve a amplitude da escala.
      expect(spread(normalized)).toBeGreaterThan(spread(raw));
      expect(Math.min(...normalized)).toBeGreaterThanOrEqual(20);
      expect(Math.max(...normalized)).toBeLessThanOrEqual(90);
    });
  });
});

// ---------------------------------------------------------------------------

interface PanelJsonShape {
  slug: string;
  categories: {
    slug: string;
    markers: {
      rsId: string;
      weight: number;
      genotypeScores: { genotype: string; score: number }[];
    }[];
    percentileCurve: { rawScore: number; percentile: number }[];
  }[];
  modalities: {
    slug: string;
    isGlobal: boolean;
    categoryWeights: { category: string; weight: number }[];
  }[];
}

/** Monta a definição do painel a partir do mesmo JSON que alimenta o seed. */
function buildPanel(
  json: PanelJsonShape,
  modalityCurves: Record<string, { rawScore: number; percentile: number }[]>,
): PanelDefinition {
  const categories: CategoryDefinition[] = json.categories.map((category) => ({
    slug: category.slug,
    percentileCurve: category.percentileCurve,
    markers: category.markers.map((marker) => ({
      rsId: marker.rsId,
      weight: marker.weight,
      genotypeScores: new Map(marker.genotypeScores.map((gs) => [gs.genotype, gs.score])),
    })),
  }));

  const modalities: ModalityDefinition[] = json.modalities.map((modality) => ({
    slug: modality.slug,
    isGlobal: modality.isGlobal,
    categoryWeights: new Map(modality.categoryWeights.map((cw) => [cw.category, cw.weight])),
    percentileCurve: modalityCurves[modality.slug] ?? [],
  }));

  const aliases = json.categories
    .flatMap((c) => c.markers)
    .map((marker) =>
      GenotypeNormalizer.buildAliases(
        marker.rsId,
        marker.genotypeScores.map((gs) => gs.genotype),
      ),
    );

  return { slug: json.slug, categories, modalities, aliases };
}
