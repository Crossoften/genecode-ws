/**
 * Em que escala cada categoria é **mostrada** (GC-N05-04).
 *
 * Todo escore do painel cresce para o lado bom: 100 é o genótipo favorável.
 * Para "Risco de Lesão & Estrutura" isso se lê ao contrário. O nome promete
 * um risco, e o número alto (84,7) parece risco alto, quando quer dizer o
 * oposto: menos variantes associadas a lesão. O Flávio apontou em 05/11 que
 * "a pessoa com risco alto aparece como se fosse bom".
 *
 * A correção é só de **exibição**. O banco, as faixas, o global, o ajustado e
 * os esportes continuam calculados sobre o escore de sempre. Na saída para a
 * tela, a categoria de risco mostra `100 − escore`, e a faixa ganha nome de
 * risco: Favorável vira "risco baixo". Assim 84,7 aparece como 15,3, risco
 * baixo, e ninguém mais lê o número ao contrário.
 */
export type EscalaExibicao = 'ESCORE' | 'RISCO';

/** Categorias cujo nome fala de risco, e que por isso se mostram como risco. */
const CATEGORIAS_DE_RISCO: ReadonlySet<string> = new Set(['risco_lesao']);

export function escalaDa(slug: string): EscalaExibicao {
  return CATEGORIAS_DE_RISCO.has(slug) ? 'RISCO' : 'ESCORE';
}

/** O número que a tela mostra. Uma casa decimal, como os escores. */
export function valorExibido(slug: string, escore: number): number {
  if (escalaDa(slug) === 'ESCORE') return escore;
  return Math.round((100 - escore) * 10) / 10;
}

/** O mesmo, para o ajustado, que pode não existir ainda. */
export function valorExibidoOuNulo(slug: string, escore: number | null | undefined): number | null {
  return escore === null || escore === undefined ? null : valorExibido(slug, escore);
}
