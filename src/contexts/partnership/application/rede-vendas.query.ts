import type { PrismaService } from '@infra/database/prisma.service';

import { NIVEL_MAXIMO } from '../domain/rede';

/** O desempenho da sub-rede de um indicado — a "unidade", no vocabulário do cliente. */
export interface VendasDaUnidade {
  /** Pedidos pagos no cupom dele e no de quem está abaixo dele. */
  readonly orders: number;
  /** Valor dos pedidos, em centavos. */
  readonly revenueCents: number;
  /** Produto com mais unidades vendidas na sub-rede, ou null. */
  readonly topProduct: string | null;
  /** Quantos parceiros existem abaixo dele, em todos os níveis. */
  readonly subRede: number;
}

/**
 * Quanto cada unidade da minha rede vendeu.
 *
 * Pedido do cliente na call de 09/10, com o caso dele: o franqueador da rede
 * de academias convida a unidade Paulista, a unidade convida os professores, e
 * a pergunta do franqueador é *"quanto tá vendendo por unidade, qual o exame
 * que tá vendendo mais"*.
 *
 * A conta é por **sub-rede**, não por cupom: a unidade Paulista vende pelo
 * cupom dela e pelos cupons dos professores que ela cadastrou, e separar as
 * duas coisas responderia uma pergunta que ninguém fez. Quem quer o recorte do
 * cupom próprio tem a tela "Minhas vendas".
 *
 * Nada aqui mostra comprador: a regra do módulo do parceiro é que ele vê
 * número de pedido e produto, nunca quem comprou.
 */
export async function vendasPorUnidade(
  prisma: PrismaService,
  filhosIds: readonly string[],
): Promise<ReadonlyMap<string, VendasDaUnidade>> {
  const vazio = new Map<string, VendasDaUnidade>();
  if (filhosIds.length === 0) return vazio;

  // Desce a árvore nível a nível, guardando a qual filho cada descendente
  // pertence. `NIVEL_MAXIMO` é o teto da rede e também a guarda contra ciclo:
  // uma cadeia que se mordesse o rabo rodaria para sempre aqui.
  const raizDe = new Map<string, string>(filhosIds.map((id) => [id, id]));
  let fronteira: readonly string[] = filhosIds;

  for (let nivel = 0; nivel < NIVEL_MAXIMO && fronteira.length > 0; nivel += 1) {
    const netos = await prisma.partner.findMany({
      where: { parentId: { in: [...fronteira] } },
      select: { id: true, parentId: true, couponCode: true },
    });
    const proxima: string[] = [];
    for (const neto of netos) {
      if (raizDe.has(neto.id) || neto.parentId === null) continue;
      const raiz = raizDe.get(neto.parentId);
      if (raiz === undefined) continue;
      raizDe.set(neto.id, raiz);
      proxima.push(neto.id);
    }
    fronteira = proxima;
  }

  const parceiros = await prisma.partner.findMany({
    where: { id: { in: [...raizDe.keys()] } },
    select: { id: true, couponCode: true },
  });
  const raizPorCupom = new Map<string, string>();
  for (const parceiro of parceiros) {
    const raiz = raizDe.get(parceiro.id);
    if (raiz) raizPorCupom.set(parceiro.couponCode, raiz);
  }

  // Só pedido pago entra: venda não paga é intenção, e o painel do parceiro é
  // sobre o que gerou dinheiro.
  const pedidos = await prisma.order.findMany({
    where: { couponCode: { in: [...raizPorCupom.keys()] }, paidAt: { not: null } },
    select: {
      couponCode: true,
      totalCents: true,
      items: { select: { productName: true, quantity: true } },
    },
  });

  const acumulado = new Map<
    string,
    { orders: number; revenueCents: number; produtos: Map<string, number> }
  >();
  for (const pedido of pedidos) {
    const raiz = pedido.couponCode ? raizPorCupom.get(pedido.couponCode) : undefined;
    if (!raiz) continue;
    const atual = acumulado.get(raiz) ?? {
      orders: 0,
      revenueCents: 0,
      produtos: new Map<string, number>(),
    };
    atual.orders += 1;
    atual.revenueCents += pedido.totalCents;
    for (const item of pedido.items) {
      atual.produtos.set(
        item.productName,
        (atual.produtos.get(item.productName) ?? 0) + item.quantity,
      );
    }
    acumulado.set(raiz, atual);
  }

  const subRede = new Map<string, number>();
  for (const [id, raiz] of raizDe) {
    if (id === raiz) continue;
    subRede.set(raiz, (subRede.get(raiz) ?? 0) + 1);
  }

  const resultado = new Map<string, VendasDaUnidade>();
  for (const filho of filhosIds) {
    const dados = acumulado.get(filho);
    resultado.set(filho, {
      orders: dados?.orders ?? 0,
      revenueCents: dados?.revenueCents ?? 0,
      topProduct:
        dados === undefined
          ? null
          : ([...dados.produtos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null),
      subRede: subRede.get(filho) ?? 0,
    });
  }
  return resultado;
}
