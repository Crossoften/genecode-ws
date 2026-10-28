export const SHIPPING_PROVIDER = Symbol('SHIPPING_PROVIDER');

export interface ShippingQuoteRequest {
  readonly destinationZipCode: string;
  /**
   * Cidade do destino. A DHL exige a cidade além do CEP para cotar
   * (`destinationCityName`); o sandbox ignora.
   */
  readonly destinationCity?: string;
  readonly weightGrams: number;
}

export interface ShippingOption {
  readonly code: string;
  readonly name: string;
  readonly priceCents: number;
  readonly estimatedDays: number;
}

/** Uma ponta do envio: quem manda ou quem recebe. */
export interface ShippingParty {
  readonly name: string;
  /** Razão social quando é empresa; a DHL exige o campo mesmo para pessoa física. */
  readonly company?: string;
  readonly phone: string;
  readonly email?: string;
  /** CPF ou CNPJ, só dígitos. */
  readonly document?: string;
  readonly zipCode: string;
  readonly street: string;
  readonly number: string;
  readonly complement?: string | null;
  readonly district?: string | null;
  readonly city: string;
  readonly state: string;
  readonly kind: 'business' | 'private';
}

export interface ShippingPackage {
  readonly weightGrams: number;
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
}

export interface LabelRequest {
  readonly orderNumber: string;
  readonly method: string;
  readonly destinationZipCode: string;
  /** Etiqueta de volta: cliente → laboratório. */
  readonly reverse?: boolean;
  /** Remetente e destinatário completos — a DHL não emite só com o CEP. */
  readonly from?: ShippingParty;
  readonly to?: ShippingParty;
  readonly parcel?: ShippingPackage;
}

export interface LabelResult {
  readonly trackingCode: string;
  /** Etiqueta pronta para imprimir, quando o provedor devolve uma. */
  readonly label?: { readonly format: 'PDF' | 'ZPL'; readonly base64: string };
  readonly trackingUrl?: string;
}

/** Um evento de rastreio, já normalizado. */
export interface TrackingEvent {
  readonly at: Date;
  /** Código da transportadora (`PU`, `OK`…). */
  readonly code: string;
  readonly description: string;
  readonly location: string | null;
}

/**
 * O envio a rastrear. Além do código vão a data da etiqueta e a da coleta:
 * o ambiente de teste da DHL só rastreia 15 conhecimentos fixos, então o teste
 * da jornada (GC-AJ-042) simula os eventos a partir dessas datas.
 */
export interface TrackRequest {
  readonly trackingCode: string;
  readonly reverse: boolean;
  readonly createdAt: Date;
  readonly pickupAt: Date | null;
}

export interface TrackingResult {
  readonly trackingCode: string;
  /** Do mais antigo para o mais recente. */
  readonly events: readonly TrackingEvent[];
}

export interface PickupRequest {
  readonly orderNumber: string;
  /** Rastreio da volta, que a coleta vai buscar. */
  readonly trackingCode: string;
  /** `AAAA-MM-DD`. */
  readonly date: string;
  /** `HH:MM`, quando o pacote fica pronto. */
  readonly readyTime: string;
  /** `HH:MM`, até quando dá para buscar. */
  readonly closeTime: string;
  /** Onde o pacote estará — "portaria", "recepção". */
  readonly location?: string;
  /** De onde a coleta sai (a casa do cliente). */
  readonly from: ShippingParty;
  /** Para onde vai (o laboratório). */
  readonly to: ShippingParty;
  readonly parcel: ShippingPackage;
}

export interface PickupResult {
  readonly confirmationNumber: string;
  /** Horário em que o pacote precisa estar pronto, se a transportadora ajustou. */
  readonly readyByTime?: string;
}

/**
 * Porta de logística: cotação, etiqueta, rastreio e coleta.
 *
 * Precisa das quatro coisas, não só de rastreio. A decisão F4 definiu que **o
 * frete é pago pelo cliente**, então é preciso cotar no checkout; a jornada
 * tem dois trajetos — laboratório → cliente e cliente → laboratório — cada um
 * com sua etiqueta; e a volta, combinada em 26/10, sai com **retirada na
 * casa do cliente** (GC-AJ-041).
 *
 * A transportadora escolhida em 26/10 é a DHL Express (GC-AJ-038).
 */
export interface ShippingProvider {
  /** Opções de envio para um CEP. */
  quote(request: ShippingQuoteRequest): Promise<ShippingOption[]>;

  /** Emite a etiqueta e devolve o código de rastreio. */
  createLabel(request: LabelRequest): Promise<LabelResult>;

  /** Eventos de rastreio de um envio. */
  track(request: TrackRequest): Promise<TrackingResult>;

  /** Agenda a retirada do pacote da volta. */
  schedulePickup(request: PickupRequest): Promise<PickupResult>;
}
