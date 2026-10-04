/**
 * Estados do pedido, do pagamento à entrega do laudo.
 *
 * Uma máquina de estados só. A análise dos protótipos encontrou **três
 * vocabulários diferentes** para a mesma jornada — o da Área do Paciente, o do
 * Admin e o do Genoa — com nomes e quantidades distintos. Convergir num só é
 * pré-requisito para o acompanhamento do cliente e a esteira de SLA do admin
 * falarem da mesma coisa.
 */
export enum OrderStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  KIT_SHIPPED = 'KIT_SHIPPED',
  KIT_DELIVERED = 'KIT_DELIVERED',
  SAMPLE_IN_TRANSIT = 'SAMPLE_IN_TRANSIT',
  SAMPLE_RECEIVED = 'SAMPLE_RECEIVED',
  PROCESSING = 'PROCESSING',
  REPORT_READY = 'REPORT_READY',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

/**
 * Transições permitidas.
 *
 * Declarar o grafo em vez de espalhar `if` pelos casos de uso é o que impede um
 * pedido de pular etapa — de `PENDING_PAYMENT` direto para `REPORT_READY`, por
 * exemplo. Num fluxo que envolve amostra biológica, saltar etapa significa
 * perder o rastro de onde o material está.
 */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.KIT_SHIPPED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
  [OrderStatus.KIT_SHIPPED]: [OrderStatus.KIT_DELIVERED, OrderStatus.REFUNDED],
  [OrderStatus.KIT_DELIVERED]: [OrderStatus.SAMPLE_IN_TRANSIT, OrderStatus.REFUNDED],
  [OrderStatus.SAMPLE_IN_TRANSIT]: [OrderStatus.SAMPLE_RECEIVED],
  // Volta para SAMPLE_IN_TRANSIT existe de propósito: a coleta pode falhar e o
  // laboratório reenvia o swab. O cliente pediu métrica dessa taxa no BI, então
  // o reenvio é caso previsto, não exceção.
  [OrderStatus.SAMPLE_RECEIVED]: [OrderStatus.PROCESSING, OrderStatus.SAMPLE_IN_TRANSIT],
  [OrderStatus.PROCESSING]: [OrderStatus.REPORT_READY, OrderStatus.SAMPLE_IN_TRANSIT],
  // Terminais.
  [OrderStatus.REPORT_READY]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]: [],
};

/**
 * Rótulo que o cliente vê no acompanhamento.
 *
 * Igual, palavra por palavra, ao `SITUACAO_ROTULO_CURTO` do front
 * (`shared/domain/situacao-pedido.ts`). Até 03/10 havia quatro mapas em
 * desacordo — este, o do modal do admin, o da linha do tempo do admin e o da
 * área do paciente. Dois estados diferentes chegavam a ter o mesmo nome na
 * mesma tela, o que fez a operação concluir que a gravação falhava quando ela
 * funcionava (GEN-03 e GEN-05 do relatório de 01/10). Mexer aqui pede mexer lá.
 */
export const STATUS_LABEL: Readonly<Record<OrderStatus, string>> = {
  [OrderStatus.PENDING_PAYMENT]: 'Aguardando pagamento',
  [OrderStatus.PAID]: 'Pago',
  [OrderStatus.KIT_SHIPPED]: 'Kit enviado',
  [OrderStatus.KIT_DELIVERED]: 'Kit entregue',
  [OrderStatus.SAMPLE_IN_TRANSIT]: 'Amostra a caminho',
  [OrderStatus.SAMPLE_RECEIVED]: 'Amostra recebida',
  [OrderStatus.PROCESSING]: 'Em análise',
  [OrderStatus.REPORT_READY]: 'Laudo disponível',
  [OrderStatus.CANCELLED]: 'Cancelado',
  [OrderStatus.REFUNDED]: 'Reembolsado',
};

/** Ordem de exibição na linha do tempo. Cancelado e reembolsado ficam fora. */
export const TIMELINE: readonly OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.KIT_SHIPPED,
  OrderStatus.KIT_DELIVERED,
  OrderStatus.SAMPLE_IN_TRANSIT,
  OrderStatus.SAMPLE_RECEIVED,
  OrderStatus.PROCESSING,
  OrderStatus.REPORT_READY,
];

/**
 * Verifica se a transição é permitida.
 *
 * @param from - Estado atual.
 * @param to - Estado pretendido.
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Estados alcançáveis a partir do atual. Alimenta o seletor do admin. */
export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

/** True quando o pedido não avança mais. */
export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
