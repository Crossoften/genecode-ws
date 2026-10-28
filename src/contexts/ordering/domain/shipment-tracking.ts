import { OrderStatus, TIMELINE, canTransition } from './order-status';
import type { TrackingEvent } from './ports/shipping-provider.port';

/**
 * Tradução dos eventos da transportadora para a esteira do pedido (GC-AJ-040).
 *
 * Em 26/10 o pedido era movido à mão pelo admin. Com o rastreio, os eventos da
 * DHL movem o pedido sozinhos — sempre **para frente** e pelo mesmo caminho da
 * máquina de estados: um evento atrasado nunca faz o pedido voltar.
 *
 * Códigos da tabela `trackingEventCode` da MyDHL API (3.4.0).
 */

/** O pacote saiu das mãos de quem enviou: coletado ou já em trânsito. */
const EM_TRANSITO = new Set(['PU', 'PL', 'DF', 'AF', 'AR', 'WC']);
/** Entregue, inclusive parcial ou avariado — o pacote chegou. */
const ENTREGUE = new Set(['OK', 'PD', 'DD']);

export type Direction = 'OUTBOUND' | 'INBOUND';

/**
 * A situação que o pedido deveria ter, dado o último evento de um dos envios.
 * `null` quando o evento não diz nada à esteira (`SD`, exceções).
 */
export function targetStatusFor(direction: Direction, events: readonly TrackingEvent[]): OrderStatus | null {
  const codes = events.map((event) => event.code);
  const delivered = codes.some((code) => ENTREGUE.has(code));
  const moving = codes.some((code) => EM_TRANSITO.has(code));

  if (direction === 'OUTBOUND') {
    if (delivered) return OrderStatus.KIT_DELIVERED;
    if (moving) return OrderStatus.KIT_SHIPPED;
    return null;
  }
  if (delivered) return OrderStatus.SAMPLE_RECEIVED;
  if (moving) return OrderStatus.SAMPLE_IN_TRANSIT;
  return null;
}

/**
 * Os passos para ir de `from` até `target` pela linha do tempo, um estado por
 * vez. Vazio quando o pedido já está lá, já passou, ou o caminho não é
 * permitido (cancelado, reembolsado).
 */
export function forwardPath(from: OrderStatus, target: OrderStatus): OrderStatus[] {
  const start = TIMELINE.indexOf(from);
  const end = TIMELINE.indexOf(target);
  if (start < 0 || end < 0 || end <= start) return [];

  const path: OrderStatus[] = [];
  let current = from;
  for (const next of TIMELINE.slice(start + 1, end + 1)) {
    if (!canTransition(current, next)) return [];
    path.push(next);
    current = next;
  }
  return path;
}

/** Rótulo em português para os códigos mais comuns, quando a DHL manda em inglês. */
export const EVENT_LABEL: Readonly<Record<string, string>> = {
  SD: 'Etiqueta emitida',
  PU: 'Coletado',
  PL: 'Processado no centro de distribuição',
  DF: 'Saiu do centro de distribuição',
  AF: 'Chegou ao centro de distribuição',
  AR: 'Chegou à unidade de entrega',
  WC: 'Saiu para entrega',
  OK: 'Entregue',
  PD: 'Entregue parcialmente',
  DD: 'Entregue com avaria',
  NH: 'Destinatário ausente',
  BA: 'Endereço incorreto',
  CA: 'Local fechado na tentativa de entrega',
  MD: 'Entrega não realizada no ciclo',
  RD: 'Recusado',
  CM: 'Destinatário mudou de endereço',
  OH: 'Em espera',
  RT: 'Devolvido ao remetente',
};

/**
 * Linha do tempo simulada de um envio (GC-AJ-042).
 *
 * O ambiente de teste da DHL **não rastreia** os conhecimentos que ele mesmo
 * emite — só 15 números fixos. Para testar a jornada inteira, ida e volta, os
 * eventos são derivados do tempo: a ida começa na emissão da etiqueta; a volta,
 * na coleta agendada (sem coleta, a volta não anda). Cada etapa leva
 * `minutesPerStep` minutos.
 */
export function simulatedEvents(
  request: { reverse: boolean; createdAt: Date; pickupAt: Date | null },
  now: Date,
  minutesPerStep: number,
): TrackingEvent[] {
  const start = request.reverse ? request.pickupAt : request.createdAt;
  if (!start || now < start) return [];

  const steps: Array<[string, string]> = request.reverse
    ? [
        ['PU', 'Coletado na residência'],
        ['AF', 'Chegou ao centro de distribuição'],
        ['WC', 'Saiu para entrega ao laboratório'],
        ['OK', 'Entregue ao laboratório'],
      ]
    : [
        ['PU', 'Coletado no laboratório'],
        ['AF', 'Chegou ao centro de distribuição'],
        ['WC', 'Saiu para entrega'],
        ['OK', 'Entregue'],
      ];

  const stepMs = Math.max(minutesPerStep, 1) * 60_000;
  const elapsed = Math.floor((now.getTime() - start.getTime()) / stepMs);
  return steps.slice(0, Math.min(elapsed + 1, steps.length)).map(([code, description], index) => ({
    at: new Date(start.getTime() + index * stepMs),
    code,
    description: `${description} (simulado)`,
    location: 'São Paulo',
  }));
}
