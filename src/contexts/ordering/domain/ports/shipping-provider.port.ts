export const SHIPPING_PROVIDER = Symbol('SHIPPING_PROVIDER');

export interface ShippingQuoteRequest {
  readonly destinationZipCode: string;
  readonly weightGrams: number;
}

export interface ShippingOption {
  readonly code: string;
  readonly name: string;
  readonly priceCents: number;
  readonly estimatedDays: number;
}

export interface LabelRequest {
  readonly orderNumber: string;
  readonly method: string;
  readonly destinationZipCode: string;
  /** Etiqueta de volta: cliente → laboratório. */
  readonly reverse?: boolean;
}

/**
 * Porta de logística: cotação, etiqueta e rastreio.
 *
 * Precisa das três coisas, não só de rastreio. A decisão F4 definiu que **o
 * frete é pago pelo cliente**, então é preciso cotar no checkout; e a jornada
 * tem dois trajetos — laboratório → cliente e cliente → laboratório — cada um
 * com sua etiqueta.
 *
 * Por isso a recomendação passou de Melhor Rastreio, que só rastreia, para
 * Melhor Envio, que cobre os três e tem sandbox público.
 */
export interface ShippingProvider {
  /** Opções de envio para um CEP. */
  quote(request: ShippingQuoteRequest): Promise<ShippingOption[]>;

  /** Emite a etiqueta e devolve o código de rastreio. */
  createLabel(request: LabelRequest): Promise<{ trackingCode: string }>;
}
