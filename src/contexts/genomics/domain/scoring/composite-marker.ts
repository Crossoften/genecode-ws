/**
 * Marcadores compostos: dois SNPs que só têm significado clínico juntos.
 *
 * MTHFR e HFE não cabem no modelo `genótipo → escore` das outras tabelas porque
 * o efeito não é a soma dos dois: existe interação. Um portador de uma variante
 * de cada gene (heterozigoto composto) tem risco maior do que a média das duas
 * meias contribuições sugeriria, e a fórmula do laboratório reflete isso com uma
 * penalidade explícita.
 *
 * São exatamente dois casos no painel, com fórmulas próprias. Preferi
 * implementá-los como regras nomeadas a construir um motor genérico de
 * combinação — um motor para dois casos conhecidos seria abstração sem demanda,
 * e regras nomeadas ficam legíveis para quem vai conferir a matemática contra a
 * literatura.
 */

/** Escore de um genótipo, ou null quando o valor não é reconhecido. */
type GenotypeTable = Readonly<Record<string, number>>;

export interface CompositeInput {
  /** rsId → genótipo canônico observado. */
  readonly genotypes: ReadonlyMap<string, string>;
}

export interface CompositeRule {
  /** Chave usada no banco para referenciar esta regra. */
  readonly key: string;
  /** Marcadores que a regra consome. */
  readonly rsIds: readonly string[];
  /**
   * Genótipos aceitos por marcador de origem.
   *
   * Necessário porque estes SNPs não têm tabela de escore própria — a pontuação
   * deles só existe dentro da regra combinada. Sem declarar aqui, o normalizador
   * não teria como construir os aliases e rejeitaria um genótipo perfeitamente
   * válido vindo do laboratório.
   */
  readonly acceptedGenotypes: Readonly<Record<string, readonly string[]>>;
  /**
   * Calcula o escore combinado.
   *
   * @returns O escore de 0 a 100, ou null quando falta algum dos genótipos.
   */
  evaluate(input: CompositeInput): number | null;
}

/**
 * MTHFR — C677T (rs1801133) + A1298C (rs1801131).
 *
 * Os dois polimorfismos afetam a mesma enzima do metabolismo do folato. A
 * combinação de variantes desfavoráveis nos dois reduz a atividade enzimática
 * mais do que cada um isoladamente, daí a penalidade.
 *
 * ### Conflito de polaridade no C677T
 *
 * As fontes discordam sobre qual genótipo é favorável:
 *
 * | Fonte | CC | CT | TT |
 * |---|---|---|---|
 * | Planilha "Painel SNPs Nutri" | **100** | 55 | **15** |
 * | `Algoritmo nutrigenomica_normalizado.py` | **15** | 55 | **100** |
 *
 * Adotei a planilha. É a leitura consistente com a literatura: o genótipo 677TT
 * reduz a atividade da MTHFR para cerca de 30% do normal e está associado a
 * hiperhomocisteinemia e maior necessidade de folato — é o genótipo
 * desfavorável, não o favorável.
 *
 * Isso segue o mesmo padrão dos conflitos já registrados no ADRB3 e no SOD2: o
 * Python tem inversões pontuais. **Precisa de ratificação do Dr. Câmara.**
 *
 * A penalidade foi transposta preservando a intenção, não a letra: no Python ela
 * incidia sobre `"CC"` nos dois genes porque ali CC era o desfavorável do 677.
 * Com a polaridade corrigida, o desfavorável do 677 passa a ser TT.
 */
export const MTHFR_RULE: CompositeRule = {
  key: 'mthfr',
  rsIds: ['rs1801133', 'rs1801131'],
  acceptedGenotypes: {
    rs1801133: ['CC', 'CT', 'TT'],
    rs1801131: ['AA', 'AC', 'CC'],
  },

  evaluate({ genotypes }): number | null {
    const c677t = genotypes.get('rs1801133');
    const a1298c = genotypes.get('rs1801131');
    if (!c677t || !a1298c) return null;

    // Polaridade da planilha: CC favorável, TT desfavorável.
    const SCORE_677: GenotypeTable = { CC: 100, CT: 55, TC: 55, TT: 15 };
    const SCORE_1298: GenotypeTable = { AA: 100, AC: 60, CA: 60, CC: 25 };

    const first = SCORE_677[c677t];
    const second = SCORE_1298[a1298c];
    if (first === undefined || second === undefined) return null;

    // Pesos do laboratório: o C677T pesa mais por ter efeito enzimático maior.
    const base = first * 0.55 + second * 0.45;

    const unfavourable677 = c677t === 'TT';
    const unfavourable1298 = a1298c === 'CC';

    if (unfavourable677 && unfavourable1298) return Math.max(0, base - 15);
    if (unfavourable677 || unfavourable1298) return Math.max(0, base - 8);
    return base;
  },
};

/**
 * HFE — C282Y (rs1800562) + H63D (rs1799945).
 *
 * As duas variantes clássicas da hemocromatose hereditária. A penalidade maior
 * cai sobre o **heterozigoto composto** (uma cópia de cada), que é justamente a
 * combinação de relevância clínica reconhecida — e que o modelo aditivo simples
 * subestimaria.
 *
 * Polaridade concordante entre a planilha e o Python; nada a arbitrar aqui.
 */
export const HFE_RULE: CompositeRule = {
  key: 'hfe',
  rsIds: ['rs1800562', 'rs1799945'],
  acceptedGenotypes: {
    rs1800562: ['GG', 'AG', 'AA'],
    rs1799945: ['CC', 'CG', 'GG'],
  },

  evaluate({ genotypes }): number | null {
    const c282y = genotypes.get('rs1800562');
    const h63d = genotypes.get('rs1799945');
    if (!c282y || !h63d) return null;

    const SCORE_C282Y: GenotypeTable = { GG: 100, AG: 40, GA: 40, AA: 0 };
    const SCORE_H63D: GenotypeTable = { CC: 100, CG: 50, GC: 50, GG: 10 };

    const first = SCORE_C282Y[c282y];
    const second = SCORE_H63D[h63d];
    if (first === undefined || second === undefined) return null;

    const base = first * 0.6 + second * 0.4;

    const heterozygous282 = c282y === 'AG' || c282y === 'GA';
    const heterozygous63 = h63d === 'CG' || h63d === 'GC';

    // Heterozigoto composto: uma cópia de cada variante.
    if (heterozygous282 && heterozygous63) return Math.max(0, base - 20);
    // Homozigoto para C282Y, o genótipo de maior risco isolado.
    if (c282y === 'AA') return Math.max(0, base - 10);
    return base;
  },
};

/** Regras disponíveis, indexadas pela chave usada no banco. */
export const COMPOSITE_RULES: ReadonlyMap<string, CompositeRule> = new Map([
  [MTHFR_RULE.key, MTHFR_RULE],
  [HFE_RULE.key, HFE_RULE],
]);
