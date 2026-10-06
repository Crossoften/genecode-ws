import { checkDigitsFor, isTrivialBase } from './activation-code';

/** Uma linha da lista primitiva, como o cliente a entregou. */
export interface LinhaDaLista {
  /** A ordem da planilha. É por ela que a Genoa imprime, e por ela que se queima. */
  readonly sequencial: number;
  readonly code: string;
  /** Base trivial — válida no módulo 11, recusada pelo validador. Nunca se imprime. */
  readonly usable: boolean;
}

const CABECALHO = 'sequencial,codigo';

/**
 * Lê a lista dos 500 mil códigos e **confere cada um** contra o módulo 11.
 *
 * A conferência é o ponto da leitura, não um extra. A lista é produzida pela
 * Genoa, fora do nosso código; se a regra dela divergisse da nossa, metade dos
 * envelopes não ativaria e só descobriríamos com a caixa na mão de alguém.
 * Divergência interrompe a carga inteira — meia lista importada seria pior que
 * nenhuma.
 *
 * @param bruto - O CSV `sequencial,codigo`, já descomprimido.
 */
export function lerListaOficial(bruto: string): LinhaDaLista[] {
  const linhas = bruto.trim().split('\n');
  const cabecalho = linhas.shift();
  if (cabecalho?.trim() !== CABECALHO) {
    throw new Error(`Cabeçalho inesperado no arquivo da lista: "${cabecalho}"`);
  }

  const vistos = new Set<string>();
  const divergentes: string[] = [];

  const lista = linhas.map((linha, indice) => {
    const [sequencialCru, code] = linha.split(',');
    const sequencial = Number(sequencialCru);

    if (!Number.isInteger(sequencial) || sequencial < 1) {
      throw new Error(`Sequencial inválido na linha ${indice + 2}: "${sequencialCru}"`);
    }
    if (!/^\d{6}-\d{2}$/.test(code ?? '')) {
      throw new Error(`Código fora do formato na linha ${indice + 2}: "${code}"`);
    }
    if (vistos.has(code)) {
      throw new Error(`Código repetido na lista: ${code} (linha ${indice + 2})`);
    }
    vistos.add(code);

    const base = code.slice(0, 6);
    if (checkDigitsFor(base) !== code.slice(7)) divergentes.push(code);

    return { sequencial, code, usable: !isTrivialBase(base) };
  });

  if (divergentes.length > 0) {
    throw new Error(
      `${divergentes.length} código(s) da lista não conferem com o módulo 11 ` +
        `(ex.: ${divergentes.slice(0, 3).join(', ')}). Carga interrompida.`,
    );
  }

  return lista;
}
