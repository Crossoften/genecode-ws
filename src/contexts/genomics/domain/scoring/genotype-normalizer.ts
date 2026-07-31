import { ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

/** Accepted spellings of a genotype for one marker, mapped to the canonical form. */
export interface GenotypeAliasMap {
  readonly rsId: string;
  /** Lower-cased alias → canonical genotype. */
  readonly aliases: ReadonlyMap<string, string>;
}

/**
 * Resolves a genotype as written in the laboratory CSV to the canonical form the
 * panel expects.
 *
 * This exists because of a real defect found while cross-checking the sources:
 * BDNF rs6265 is reported as C/T in the performance panel and G/A in the
 * nutrigenetics one. Those are the same variant read on opposite DNA strands.
 * Without normalisation, a CSV carrying `CC` would not match a panel expecting
 * `GG`, the lookup would return nothing, and the marker would be **silently
 * dropped** from the score — the patient receiving a report computed from fewer
 * markers than it claims, with no warning anywhere.
 *
 * So the rule here is deliberate: an unrecognised genotype is a **failure**, not
 * a skip. In a health product, failing loudly beats computing quietly on partial
 * data.
 */
export class GenotypeNormalizer {
  /** rsId → alias map. */
  private readonly index: ReadonlyMap<string, GenotypeAliasMap>;

  constructor(maps: readonly GenotypeAliasMap[]) {
    this.index = new Map(maps.map((map) => [map.rsId.toLowerCase(), map]));
  }

  /**
   * Normalises one observed genotype.
   *
   * @param rsId - Marker identifier, e.g. `rs6265`.
   * @param rawValue - Genotype as written in the CSV, e.g. `"CC"`, `"c/c"`.
   * @returns The canonical genotype, or a validation failure naming the marker
   *   and the value so the laboratory can fix the file.
   */
  normalize(rsId: string, rawValue: string): Result<string> {
    const cleaned = cleanGenotype(rawValue);

    if (cleaned.length === 0) {
      return fail(
        new ValidationError(`Genótipo ausente para ${rsId}.`, { rsId, rawValue }),
      );
    }

    const map = this.index.get(rsId.toLowerCase());
    if (!map) {
      return fail(
        new ValidationError(`Marcador ${rsId} não pertence a este painel.`, { rsId }),
      );
    }

    const canonical = map.aliases.get(cleaned);
    if (!canonical) {
      return fail(
        new ValidationError(
          `Genótipo "${rawValue}" não é válido para ${rsId}.`,
          { rsId, rawValue, accepted: [...new Set(map.aliases.values())] },
        ),
      );
    }

    return ok(canonical);
  }

  /**
   * Builds the alias map for a marker, covering the usual notation variants.
   *
   * For every canonical genotype we accept it as written, its reverse (`AG` for
   * `GA` — heterozygote order carries no meaning), and the complementary-strand
   * spelling. The complement is what makes the BDNF case work without the
   * laboratory having to change its export.
   *
   * @param rsId - Marker identifier.
   * @param canonicalGenotypes - Genotypes as the panel defines them.
   */
  static buildAliases(rsId: string, canonicalGenotypes: readonly string[]): GenotypeAliasMap {
    const aliases = new Map<string, string>();

    const register = (alias: string, canonical: string): void => {
      // A chave passa pela MESMA limpeza da consulta. Sem isso, genótipos com
      // separador — APOE `E3/E4`, GSTM1 `(+/-)`, 5-HTTLPR `LA/LG` — eram
      // registrados com a barra e consultados sem ela, e nunca casavam.
      const key = cleanGenotype(alias);
      // First writer wins: a canonical form must never be shadowed by a
      // complement generated for a different genotype.
      if (!aliases.has(key)) aliases.set(key, canonical);
    };

    // Canonical spellings first, so they always take precedence.
    for (const genotype of canonicalGenotypes) register(genotype, genotype);

    for (const genotype of canonicalGenotypes) {
      register(reverse(genotype), genotype);
      const complemented = complement(genotype);
      if (complemented) {
        register(complemented, genotype);
        register(reverse(complemented), genotype);
      }
    }

    return { rsId, aliases };
  }
}

/**
 * Normaliza um genótipo para comparação.
 *
 * Remove apenas o que é separador — espaço, barra, pipe e parênteses — e passa
 * para maiúsculas. Usada tanto ao construir a tabela de aliases quanto ao
 * consultar: se as duas divergirem, o marcador simplesmente não casa.
 *
 * **O hífen NÃO é removido.** No GSTM1 o painel usa notação de número de cópias
 * — `(+/+)`, `(+/-)`, `(-/-)` — em que o sinal é o valor, não pontuação.
 * Removê-lo transformava `(-/-)` em string vazia e colidia `(+/-)` com `(+/+)`.
 * Nenhum marcador do painel usa hífen como separador.
 */
function cleanGenotype(value: string): string {
  return value.trim().replace(/[\s/|()]/g, '').toUpperCase();
}

/** Watson-Crick base pairs. Only applied to plain nucleotide genotypes. */
const COMPLEMENT: Readonly<Record<string, string>> = { A: 'T', T: 'A', C: 'G', G: 'C' };

function reverse(genotype: string): string {
  return [...genotype].reverse().join('');
}

/**
 * Returns the opposite-strand spelling, or null when the genotype is not a plain
 * nucleotide pair.
 *
 * Insertion/deletion notations (`DD`, `ID`, `II` for ACE), APOE haplotypes
 * (`E3/E4`), GSTM1 copy number (`(+/-)`) and 5-HTTLPR alleles (`LA/LG`) have no
 * complement — applying one would corrupt them.
 */
function complement(genotype: string): string | null {
  const bases = [...genotype];
  if (!bases.every((base) => base in COMPLEMENT)) return null;
  return bases.map((base) => COMPLEMENT[base]!).join('');
}
