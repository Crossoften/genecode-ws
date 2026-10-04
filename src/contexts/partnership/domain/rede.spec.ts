import {
  BOLO_PADRAO_PERCENT,
  NIVEL_MAXIMO,
  podeConvidar,
  repartir,
  validarCadeia,
  validarFatiaDoFilho,
  validarNivel,
  type NoDaRede,
} from './rede';

/** Monta a cadeia da raiz até quem vendeu, a partir das fatias. */
const cadeia = (...fatias: number[]): NoDaRede[] =>
  fatias.map((fatiaPercent, i) => ({
    partnerId: `p${i + 1}`,
    nivel: i + 1,
    fatiaPercent,
  }));

const PEDIDO = 60_480; // R$ 604,80 — o mesmo dos pedidos de homologação.

const percentuais = (partes: readonly { percent: number }[]) => partes.map((p) => p.percent);

describe('Rede de parceiros — o exemplo da academia', () => {
  // Fatias: rede 20 → unidade 10 → vendedor 5 → amigo 3.
  const REDE = 20, UNIDADE = 10, VENDEDOR = 5, AMIGO = 3;

  it('o amigo vende: 3 para ele, 2 para o vendedor, 5 para a unidade, 10 para a rede', () => {
    const partes = repartir(cadeia(REDE, UNIDADE, VENDEDOR, AMIGO), PEDIDO);
    expect(percentuais(partes)).toEqual([10, 5, 2, 3]);
  });

  it('o vendedor vende: 5 para ele, 5 para a unidade, 10 para a rede', () => {
    const partes = repartir(cadeia(REDE, UNIDADE, VENDEDOR), PEDIDO);
    expect(percentuais(partes)).toEqual([10, 5, 5]);
  });

  it('a unidade vende: 10 para ela, 10 para a rede', () => {
    expect(percentuais(repartir(cadeia(REDE, UNIDADE), PEDIDO))).toEqual([10, 10]);
  });

  it('o topo da rede vende: leva o bolo inteiro', () => {
    expect(percentuais(repartir(cadeia(REDE), PEDIDO))).toEqual([20]);
  });

  it('em qualquer um dos casos a soma é exatamente o bolo', () => {
    for (const fatias of [[REDE], [REDE, UNIDADE], [REDE, UNIDADE, VENDEDOR],
                          [REDE, UNIDADE, VENDEDOR, AMIGO]]) {
      const partes = repartir(cadeia(...fatias), PEDIDO);
      expect(partes.reduce((s, p) => s + p.percent, 0)).toBe(REDE);
      expect(partes.reduce((s, p) => s + p.cents, 0)).toBe(Math.floor((PEDIDO * REDE) / 100));
    }
  });
});

describe('Rede de parceiros — a estrutura complexa 80-7-5-4-2-2', () => {
  // Fatias: 20 → 13 → 8 → 4 → 2, com o quinto nível vendendo.
  const FATIAS = [20, 13, 8, 4, 2];

  it('reparte exatamente 7 − 5 − 4 − 2 − 2', () => {
    const partes = repartir(cadeia(...FATIAS), PEDIDO);
    expect(percentuais(partes)).toEqual([7, 5, 4, 2, 2]);
  });

  it('a soma dos cinco é o bolo de 20', () => {
    const partes = repartir(cadeia(...FATIAS), PEDIDO);
    expect(partes.reduce((s, p) => s + p.percent, 0)).toBe(20);
  });

  it('a Genoa fica com 80', () => {
    const partes = repartir(cadeia(...FATIAS), PEDIDO);
    const daRede = partes.reduce((s, p) => s + p.cents, 0);
    expect(PEDIDO - daRede).toBe(PEDIDO - Math.floor((PEDIDO * 20) / 100));
    expect(((PEDIDO - daRede) / PEDIDO) * 100).toBeCloseTo(80, 1);
  });
});

describe('Centavos', () => {
  it('a sobra de arredondamento fica com quem vendeu', () => {
    // 3 níveis com percentuais que não dividem o valor em centavos redondos.
    const partes = repartir(cadeia(20, 13, 8), 33_333);
    const esperado = Math.floor((33_333 * 20) / 100);
    expect(partes.reduce((s, p) => s + p.cents, 0)).toBe(esperado);
    // O vendedor é o último da cadeia.
    expect(partes[partes.length - 1].nivel).toBe(3);
  });

  it('nunca distribui mais que o bolo, em 500 valores seguidos', () => {
    for (let valor = 1_000; valor < 1_500; valor += 1) {
      const partes = repartir(cadeia(20, 13, 8, 4, 2), valor);
      const soma = partes.reduce((s, p) => s + p.cents, 0);
      expect(soma).toBe(Math.floor((valor * 20) / 100));
      expect(soma).toBeLessThanOrEqual(valor);
    }
  });

  it('parcela zerada não vira repasse', () => {
    // O intermediário cedeu a fatia inteira: fica com zero e sai da lista.
    const partes = repartir(cadeia(20, 20, 20), PEDIDO);
    expect(percentuais(partes)).toEqual([20]);
    expect(partes).toHaveLength(1);
  });
});

describe('Limites da rede', () => {
  it('o quinto nível não convida', () => {
    expect(podeConvidar(4)).toBe(true);
    expect(podeConvidar(NIVEL_MAXIMO)).toBe(false);
  });

  it('recusa criar um sexto nível', () => {
    expect(validarNivel(4).isOk()).toBe(true);
    const r = validarNivel(NIVEL_MAXIMO);
    expect(r.isFail()).toBe(true);
    if (r.isFail()) expect(r.error.message).toContain('5º nível');
  });

  it('o filho nunca recebe mais que o pai', () => {
    expect(validarFatiaDoFilho(10, 5).isOk()).toBe(true);
    expect(validarFatiaDoFilho(10, 10).isOk()).toBe(true);
    expect(validarFatiaDoFilho(10, 10.01).isFail()).toBe(true);
    expect(validarFatiaDoFilho(10, 0).isFail()).toBe(true);
    expect(validarFatiaDoFilho(10, -1).isFail()).toBe(true);
  });

  it('o bolo padrão é 20', () => {
    expect(BOLO_PADRAO_PERCENT).toBe(20);
  });
});

describe('Coerência da cadeia', () => {
  it('aceita uma cadeia bem formada', () => {
    expect(validarCadeia(cadeia(20, 13, 8, 4, 2)).isOk()).toBe(true);
  });

  it('recusa fatia que cresce para baixo', () => {
    const r = validarCadeia(cadeia(20, 13, 15));
    expect(r.isFail()).toBe(true);
    if (r.isFail()) expect(r.error.message).toContain('fatia maior');
  });

  it('recusa cadeia mais funda que o teto', () => {
    expect(validarCadeia(cadeia(20, 18, 16, 14, 12, 10)).isFail()).toBe(true);
  });

  it('recusa nível fora de ordem', () => {
    const torta = [
      { partnerId: 'a', nivel: 1, fatiaPercent: 20 },
      { partnerId: 'b', nivel: 3, fatiaPercent: 10 },
    ];
    expect(validarCadeia(torta).isFail()).toBe(true);
  });

  it('cadeia vazia é venda orgânica: não reparte nada', () => {
    expect(repartir([], PEDIDO)).toEqual([]);
    expect(validarCadeia([]).isOk()).toBe(true);
  });
});
