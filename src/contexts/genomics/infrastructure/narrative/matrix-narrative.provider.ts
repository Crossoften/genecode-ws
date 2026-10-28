import { Injectable } from '@nestjs/common';

import type {
  NarrativeCategory,
  NarrativeInput,
  NarrativeProvider,
  NarrativeReference,
  NarrativeResult,
} from '@contexts/genomics/domain/ports/narrative.provider';

import {
  ENDURANCE_SLUG,
  MATRIX_VERSION,
  MODULATORS,
  PROFILE_REFERENCES,
  PROFILES,
  REFERENCES,
  STRENGTH_SLUG,
  type MatrixLevel,
} from './result-matrix';
import { TableNarrativeProvider } from './table-narrative.provider';

/** Faixa do domínio → nível com o nome que a matriz do cliente usa. */
const LEVEL_BY_BAND: Readonly<Record<string, MatrixLevel>> = {
  FAVORAVEL: 'alta',
  INTERMEDIARIO: 'intermediaria',
  DESFAVORAVEL: 'baixa',
};

/**
 * Resumo do laudo montado pela matriz do cliente (GC-AJ-018).
 *
 * É o gerador padrão da plataforma desde 28/10/2026. O texto é sempre
 * composto, nunca escrito: um dos 9 perfis principais (Força × Resistência),
 * seguido do texto de cada modulador presente e, no fim, os números das
 * referências citadas — como manda o guia: *"No final, liste as referências
 * usando seus números de identificação."*
 *
 * Painel sem as duas categorias principais — a Nutrigenética, que não tem
 * matriz — continua com o texto de tabela, e o resultado diz isso em
 * `fallbackReason`.
 */
@Injectable()
export class MatrixNarrativeProvider implements NarrativeProvider {
  constructor(private readonly table: TableNarrativeProvider) {}

  async generate(input: NarrativeInput): Promise<NarrativeResult> {
    const bySlug = new Map(input.categories.map((category) => [category.slug, category]));
    const strength = levelOf(bySlug.get(STRENGTH_SLUG));
    const endurance = levelOf(bySlug.get(ENDURANCE_SLUG));

    if (!strength || !endurance) {
      const fallback = await this.table.generate(input);
      return { ...fallback, fallbackReason: 'painel sem matriz de resultados' };
    }

    const paragraphs = [PROFILES[`${strength}|${endurance}`]!];
    const cited = new Set<number>(PROFILE_REFERENCES);

    for (const modulator of MODULATORS) {
      const level = levelOf(bySlug.get(modulator.slug));
      // Categoria omitida no laudo (sem marcador ou sem curva) não ganha
      // texto: falar da faixa de um escore que não existe seria inventar.
      if (!level) continue;
      paragraphs.push(modulator.texts[level]);
      modulator.references.forEach((number) => cited.add(number));
    }

    const numbers = [...cited].sort((a, b) => a - b);
    paragraphs.push(`Referências: ${compactRanges(numbers)}.`);

    const references: NarrativeReference[] = numbers.map((number) => ({
      number,
      citation: REFERENCES[number]!,
    }));

    return {
      text: paragraphs.join('\n\n'),
      provider: 'matrix',
      model: null,
      promptVersion: MATRIX_VERSION,
      fallbackReason: null,
      references,
    };
  }
}

function levelOf(category: NarrativeCategory | undefined): MatrixLevel | null {
  if (!category) return null;
  return LEVEL_BY_BAND[category.band] ?? null;
}

/**
 * `[1, 3, 5, 7, 8, 9]` → `1, 3, 5, 7–9`. Três ou mais números seguidos viram
 * intervalo, como a matriz escreve ("7–13").
 */
export function compactRanges(numbers: readonly number[]): string {
  const parts: string[] = [];
  let start = 0;
  while (start < numbers.length) {
    let end = start;
    while (end + 1 < numbers.length && numbers[end + 1] === numbers[end]! + 1) end++;
    const run = numbers.slice(start, end + 1);
    parts.push(run.length >= 3 ? `${run[0]}–${run[run.length - 1]}` : run.join(', '));
    start = end + 1;
  }
  return parts.join(', ');
}
