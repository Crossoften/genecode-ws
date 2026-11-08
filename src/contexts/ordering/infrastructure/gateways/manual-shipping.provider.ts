import { ConflictError } from '@shared/domain/domain-error';

import type {
  LabelResult,
  PickupResult,
  ShippingOption,
  ShippingProvider,
  TrackingResult,
  TrackRequest,
} from '../../domain/ports/shipping-provider.port';

/**
 * Logística feita à mão (GC-N05-10).
 *
 * Decidido em 05/11: a DHL fica desligada no lançamento. Os preços dela vieram
 * até três vezes acima da proposta, com 14 dias úteis de prazo, e a Genoa vai
 * usar correio local (courier) na Grande São Paulo e a DHL só para longe, pelo
 * site dela. Com a integração ligada, todo pedido pago virava etiqueta e
 * cobrança da DHL, inclusive os que iriam pelo courier.
 *
 * Então aqui nada é emitido nem agendado. A operação despacha e **digita o
 * rastreio** na troca de situação do pedido; o cliente vê o código e a
 * transportadora. O rastreio automático não existe (cada courier fala uma
 * língua) e a situação do pedido anda pelo admin, como antes da DHL.
 *
 * A cotação devolve vazio de propósito: o preço quem dá é o frete único
 * (`FlatRateShippingProvider`), que embrulha este provedor.
 */
export class ManualShippingProvider implements ShippingProvider {
  async quote(): Promise<ShippingOption[]> {
    return [];
  }

  async createLabel(): Promise<LabelResult> {
    throw new ConflictError(
      'Envio manual: o sistema não emite etiqueta. Despache pela transportadora e informe o rastreio na troca de situação.',
    );
  }

  async track(request: TrackRequest): Promise<TrackingResult> {
    return { trackingCode: request.trackingCode, events: [] };
  }

  async schedulePickup(): Promise<PickupResult> {
    throw new ConflictError(
      'A retirada não é agendada pelo site. Veja as formas de devolver a amostra na página de devolução.',
    );
  }
}
