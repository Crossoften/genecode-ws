/**
 * A rede de parceiros e o split em cascata.
 *
 * Desenho definido pelo André em 03/10, depois de várias conversas com a Genoa.
 *
 * A venda feita por um parceiro divide o pedido em **80 Genoa / 20 rede**. Os 20
 * são o bolo, e é só ele que a cadeia reparte. Venda orgânica — sem cupom de
 * parceiro — não splita nada: fica inteira com a Genoa.
 *
 * Cada parceiro recebe uma **fatia** do pai e decide quanto passa para cada
 * filho. O quinto nível é terminal: não define fatia e não convida ninguém.
 *
 * A regra que faz a conta fechar sozinha é uma só:
 *
 * > cada nó recebe a **sua fatia menos a fatia do filho que está no caminho da
 * > venda**. Quem vendeu fica com a fatia inteira.
 *
 * Com as fatias rede 20 → unidade 10 → vendedor 5 → amigo 3, o exemplo que o
 * André deu:
 *
 * | quem vende | amigo | vendedor | unidade | rede | soma |
 * |---|---|---|---|---|---|
 * | o amigo    | 3 | 5−3 = 2 | 10−5 = 5 | 20−10 = 10 | 20 |
 * | o vendedor | — | 5       | 10−5 = 5 | 20−10 = 10 | 20 |
 * | a unidade  | — | —       | 10       | 20−10 = 10 | 20 |
 * | o topo     | — | —       | —        | 20         | 20 |
 *
 * Guardar a fatia de cada parceiro basta: o que cada um leva numa venda é
 * derivado, e a soma nunca pode estourar o bolo. Guardar "o que eu fico" em vez
 * da fatia quebraria no caso em que o próprio nó vende — aí ele leva tudo.
 */
import { ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

/** Profundidade máxima da rede. O quinto nível é terminal. */
export const NIVEL_MAXIMO = 5;

/** Bolo padrão da rede, em pontos percentuais do pedido. O admin pode mudar. */
export const BOLO_PADRAO_PERCENT = 20;

/** Um nó da cadeia, da raiz até quem vendeu. */
export interface NoDaRede {
  readonly partnerId: string;
  readonly nivel: number;
  /** Fatia do pedido que esta posição recebe, em pontos percentuais. */
  readonly fatiaPercent: number;
}

/** O que um parceiro leva numa venda específica. */
export interface ParteDoSplit {
  readonly partnerId: string;
  readonly nivel: number;
  readonly percent: number;
  readonly cents: number;
}

/** True quando este nível ainda pode convidar e repartir a própria fatia. */
export function podeConvidar(nivel: number): boolean {
  return nivel < NIVEL_MAXIMO;
}

/**
 * Valida a fatia que um parceiro quer dar a um filho.
 *
 * O filho nunca recebe mais que o pai — senão a soma da cadeia estouraria o
 * bolo e a Genoa pagaria mais do que combinou. Dar a fatia inteira é permitido:
 * é decisão de negócio do parceiro ficar com zero naquela ponta.
 */
export function validarFatiaDoFilho(
  fatiaDoPai: number,
  fatiaDoFilho: number,
): Result<void> {
  if (!Number.isFinite(fatiaDoFilho) || fatiaDoFilho <= 0) {
    return fail(new ValidationError('A fatia precisa ser maior que zero.'));
  }
  if (fatiaDoFilho > fatiaDoPai) {
    return fail(
      new ValidationError(
        `A fatia do convidado (${fatiaDoFilho}%) não pode passar da sua (${fatiaDoPai}%).`,
        { fields: { sharePercent: `O máximo que você pode ceder é ${fatiaDoPai}%.` } },
      ),
    );
  }
  return ok(undefined);
}

/** Valida que ainda cabe um nível abaixo deste. */
export function validarNivel(nivelDoPai: number): Result<number> {
  const nivelDoFilho = nivelDoPai + 1;
  if (nivelDoFilho > NIVEL_MAXIMO) {
    return fail(
      new ValidationError(
        `A rede vai até o ${NIVEL_MAXIMO}º nível, e você já está nele. ` +
          'Este nível não convida novos parceiros.',
      ),
    );
  }
  return ok(nivelDoFilho);
}

/**
 * Reparte o bolo entre a cadeia que levou à venda.
 *
 * @param cadeia - Da raiz até quem vendeu, em ordem. O último é o vendedor.
 * @param baseCents - Valor sobre o qual o percentual incide.
 *
 * O arredondamento vai para baixo em cada parcela, e **a sobra de centavos fica
 * com quem vendeu**. Distribuir a sobra para a raiz premiaria quem está longe da
 * venda; deixar a sobra com a Genoa faria a soma não bater com o bolo prometido.
 */
export function repartir(
  cadeia: readonly NoDaRede[],
  baseCents: number,
): readonly ParteDoSplit[] {
  if (cadeia.length === 0) return [];

  const partes: ParteDoSplit[] = cadeia.map((no, indice) => {
    const filhoNoCaminho = cadeia[indice + 1];
    // Quem vendeu não tem filho no caminho: leva a fatia inteira.
    const percent = filhoNoCaminho ? no.fatiaPercent - filhoNoCaminho.fatiaPercent : no.fatiaPercent;
    return {
      partnerId: no.partnerId,
      nivel: no.nivel,
      percent,
      cents: Math.floor((baseCents * percent) / 100),
    };
  });

  // Sobra de arredondamento para quem vendeu.
  const bolo = cadeia[0].fatiaPercent;
  const totalEsperado = Math.floor((baseCents * bolo) / 100);
  const totalDistribuido = partes.reduce((soma, p) => soma + p.cents, 0);
  const sobra = totalEsperado - totalDistribuido;
  if (sobra > 0) {
    const vendedor = partes[partes.length - 1];
    partes[partes.length - 1] = { ...vendedor, cents: vendedor.cents + sobra };
  }

  // Parcela zerada não vira repasse: o intermediário que cedeu a fatia inteira
  // não recebe nada, e criar um Payout de zero sujaria o financeiro.
  return partes.filter((p) => p.cents > 0);
}

/**
 * Confere que a cadeia é coerente antes de repartir.
 *
 * Existe porque uma cadeia inválida não produz erro — produz split silenciosamente
 * errado, com dinheiro indo para o lugar errado. É barato conferir.
 */
export function validarCadeia(cadeia: readonly NoDaRede[]): Result<void> {
  if (cadeia.length === 0) return ok(undefined);
  if (cadeia.length > NIVEL_MAXIMO) {
    return fail(new ValidationError(`A cadeia tem ${cadeia.length} níveis; o teto é ${NIVEL_MAXIMO}.`));
  }
  for (let i = 0; i < cadeia.length; i += 1) {
    if (cadeia[i].nivel !== i + 1) {
      return fail(new ValidationError('A cadeia está fora de ordem: o nível não acompanha a posição.'));
    }
    if (i > 0 && cadeia[i].fatiaPercent > cadeia[i - 1].fatiaPercent) {
      return fail(
        new ValidationError(
          `O nível ${i + 1} tem fatia maior que o nível ${i} ` +
            `(${cadeia[i].fatiaPercent}% contra ${cadeia[i - 1].fatiaPercent}%).`,
        ),
      );
    }
  }
  return ok(undefined);
}

/** Uma fatia do plano de split, como fica gravada no pedido. */
export interface FatiaDoPlano {
  readonly partnerId: string;
  readonly level: number;
  readonly sharePercent: number;
  readonly amountCents: number;
  /** Entrou na lista mandada à adquirente? Falso = fica para repasse manual. */
  readonly viaSplit: boolean;
}

/**
 * Monta o plano de split da venda.
 *
 * Separa o que vai para a adquirente do que fica para repasse manual. Quem não
 * tem `splitMerchantId` não entra na lista da adquirente — a fatia dele
 * permanece com a Genoa e o financeiro repassa na mão. Bloquear a venda porque
 * falta cadastro de um parceiro seria punir o cliente por pendência que não é
 * dele, e o plano guarda a fatia mesmo assim: ela é devida, tenha ido pelo
 * split ou não.
 *
 * @param cadeia - Da raiz até quem vendeu.
 * @param merchantPorParceiro - `splitMerchantId` de cada um, ou null.
 * @param baseCents - Valor dos produtos já com desconto.
 */
export function montarPlano(
  cadeia: readonly NoDaRede[],
  merchantPorParceiro: ReadonlyMap<string, string | null>,
  baseCents: number,
): {
  readonly plano: readonly FatiaDoPlano[];
  readonly paraAdquirente: readonly { merchantRef: string; amountCents: number }[];
} {
  const plano = repartir(cadeia, baseCents).map((parte) => ({
    partnerId: parte.partnerId,
    level: parte.nivel,
    sharePercent: parte.percent,
    amountCents: parte.cents,
    viaSplit: (merchantPorParceiro.get(parte.partnerId) ?? null) !== null,
  }));

  const paraAdquirente = plano
    .filter((fatia) => fatia.viaSplit)
    .map((fatia) => ({
      merchantRef: merchantPorParceiro.get(fatia.partnerId) as string,
      amountCents: fatia.amountCents,
    }));

  return { plano, paraAdquirente };
}
