import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { UpstreamError, ValidationError } from '@shared/domain/domain-error';

import { EVENT_LABEL, simulatedEvents } from '../../domain/shipment-tracking';
import type {
  LabelRequest,
  LabelResult,
  PickupRequest,
  PickupResult,
  ShippingOption,
  ShippingPackage,
  ShippingParty,
  ShippingProvider,
  ShippingQuoteRequest,
  TrackingEvent,
  TrackingResult,
  TrackRequest,
} from '../../domain/ports/shipping-provider.port';

/** Endereços da MyDHL API (3.4.0). */
export const DHL_TEST_URL = 'https://express.api.dhl.com/mydhlapi/test';
export const DHL_PRODUCTION_URL = 'https://express.api.dhl.com/mydhlapi';

/** Versão do contrato. A DHL pede o cabeçalho em toda chamada e que não mude. */
const API_VERSION = '3.4.0';

/** Horário de Brasília no formato que a DHL lê (`GMT-03:00`). */
const BRT = 'GMT-03:00';

export interface DhlConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  /** Conta DHL Express da Genoa — paga a ida e a volta. */
  readonly accountNumber: string;
  /** `N` (Express Domestic) por padrão; a conta pode ter outros. */
  readonly productCode: string;
  readonly labelFormat: 'pdf' | 'zpl';
  readonly labelTemplate: string;
  /** O laboratório: origem da ida e destino da volta. */
  readonly origin: ShippingParty;
  /** Minutos por etapa na simulação de rastreio do ambiente de teste. */
  readonly simulationMinutesPerStep: number;
}

/**
 * Logística pela DHL Express — MyDHL API (GC-AJ-038 a 042).
 *
 * Escopo combinado em 26/10: ida e volta com rastreio, retirada na casa do
 * cliente, sem estoque. A integração usa a **chave de API** do portal de
 * desenvolvedor da DHL, não o login do site MyDHL.
 *
 * ### Três fatos da API que moldaram este adaptador
 *
 * - **Não há "etiqueta de retorno"** no contrato doméstico. A volta é um envio
 *   comum com o cliente como remetente, o laboratório como destinatário e a
 *   conta da Genoa pagando.
 * - **A etiqueta só vem na criação** — não há como buscá-la de novo depois.
 *   Quem chama precisa guardar o PDF na hora.
 * - **O ambiente de teste não rastreia** o que ele mesmo emite (só 15 números
 *   fixos). Em teste, o rastreio é simulado a partir da data da etiqueta e da
 *   coleta, para a jornada inteira poder ser exercitada (GC-AJ-042).
 */
export class DhlExpressShippingProvider implements ShippingProvider {
  private readonly logger = new Logger('DHL');

  constructor(
    private readonly config: DhlConfig,
    private readonly http: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get isTest(): boolean {
    return this.config.baseUrl.replace(/\/+$/, '').endsWith('/test');
  }

  async quote(request: ShippingQuoteRequest): Promise<ShippingOption[]> {
    if (!request.destinationCity) {
      throw new ValidationError('Informe a cidade junto do CEP para cotar o frete.');
    }
    const parcel = kitParcel(request.weightGrams);
    const query = new URLSearchParams({
      accountNumber: this.config.accountNumber,
      originCountryCode: 'BR',
      originPostalCode: zip(this.config.origin.zipCode),
      originCityName: ascii(this.config.origin.city),
      destinationCountryCode: 'BR',
      destinationPostalCode: zip(request.destinationZipCode),
      destinationCityName: ascii(request.destinationCity),
      weight: kg(parcel.weightGrams),
      length: String(parcel.lengthCm),
      width: String(parcel.widthCm),
      height: String(parcel.heightCm),
      plannedShippingDate: nextBusinessDay(this.now()).date,
      isCustomsDeclarable: 'false',
      unitOfMeasurement: 'metric',
      nextBusinessDay: 'true',
    });

    const body = await this.call<DhlRatesResponse>('GET', `/rates?${query.toString()}`);
    return (body.products ?? []).map((product) => {
      const price =
        product.totalPrice?.find((entry) => entry.currencyType === 'BILLC') ??
        product.totalPrice?.[0];
      return {
        code: product.productCode,
        name: productName(product.productName),
        priceCents: Math.round((price?.price ?? 0) * 100),
        estimatedDays: product.deliveryCapabilities?.totalTransitDays ?? 2,
      };
    });
  }

  async createLabel(request: LabelRequest): Promise<LabelResult> {
    if (!request.from || !request.to) {
      throw new ValidationError('Remetente e destinatário completos são obrigatórios na DHL.');
    }
    const parcel = request.parcel ?? kitParcel(180);
    const shipping = nextBusinessDay(this.now());

    const body = await this.call<DhlShipmentResponse>('POST', '/shipments', {
      plannedShippingDateAndTime: `${shipping.date}T10:00:00 ${BRT}`,
      // A volta é coletada por /pickups, com a data que o cliente escolher; a
      // ida sai do laboratório na coleta regular da conta.
      pickup: { isRequested: false },
      productCode: this.config.productCode,
      localProductCode: this.config.productCode,
      accounts: [{ typeCode: 'shipper', number: this.config.accountNumber }],
      customerReferences: [
        { value: `${request.orderNumber}${request.reverse ? '-VOLTA' : '-IDA'}`, typeCode: 'CU' },
      ],
      customerDetails: {
        shipperDetails: party(request.from),
        receiverDetails: party(request.to),
      },
      content: {
        packages: [packageOf(parcel)],
        isCustomsDeclarable: false,
        description: request.reverse ? 'Amostra para analise laboratorial' : 'Kit de coleta de DNA',
        unitOfMeasurement: 'metric',
      },
      outputImageProperties: {
        encodingFormat: this.config.labelFormat,
        imageOptions: [
          { typeCode: 'label', templateName: this.config.labelTemplate },
          { typeCode: 'waybillDoc', isRequested: false },
        ],
      },
    });

    const document = body.documents?.find((doc) => doc.typeCode === 'label') ?? body.documents?.[0];
    return {
      trackingCode: body.shipmentTrackingNumber,
      trackingUrl: body.trackingUrl,
      label: document
        ? {
            format: (document.imageFormat ?? '').toUpperCase() === 'ZPL' ? 'ZPL' : 'PDF',
            base64: document.content,
          }
        : undefined,
    };
  }

  async track(request: TrackRequest): Promise<TrackingResult> {
    if (this.isTest) {
      return {
        trackingCode: request.trackingCode,
        events: simulatedEvents(request, this.now(), this.config.simulationMinutesPerStep),
      };
    }

    const body = await this.call<DhlTrackingResponse>(
      'GET',
      `/shipments/${encodeURIComponent(request.trackingCode)}/tracking` +
        '?trackingView=all-checkpoints&levelOfDetail=shipment',
    );
    const events: TrackingEvent[] = (body.shipments?.[0]?.events ?? [])
      .map((event) => ({
        at: new Date(`${event.date}T${event.time ?? '00:00:00'}-03:00`),
        code: event.typeCode ?? '',
        description: EVENT_LABEL[event.typeCode ?? ''] ?? event.description ?? '',
        location: event.serviceArea?.[0]?.description ?? null,
      }))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    return { trackingCode: request.trackingCode, events };
  }

  async schedulePickup(request: PickupRequest): Promise<PickupResult> {
    const body = await this.call<DhlPickupResponse>('POST', '/pickups', {
      plannedPickupDateAndTime: `${request.date}T${request.readyTime}:00 ${BRT}`,
      closeTime: request.closeTime,
      location: (request.location ?? 'Residência').slice(0, 80),
      locationType: 'residence',
      accounts: [{ typeCode: 'shipper', number: this.config.accountNumber }],
      specialInstructions: [{ value: `Amostra gene.code ${request.orderNumber}`.slice(0, 80) }],
      customerDetails: {
        shipperDetails: party(request.from),
        receiverDetails: party(request.to),
      },
      shipmentDetails: [
        {
          productCode: this.config.productCode,
          localProductCode: this.config.productCode,
          accounts: [{ typeCode: 'shipper', number: this.config.accountNumber }],
          shipmentTrackingNumber: request.trackingCode,
          isCustomsDeclarable: false,
          unitOfMeasurement: 'metric',
          packages: [packageOf(request.parcel)],
        },
      ],
    });

    const confirmation = body.dispatchConfirmationNumbers?.[0];
    if (!confirmation) throw new UpstreamError('A DHL não confirmou a coleta.');
    return { confirmationNumber: confirmation, readyByTime: body.readyByTime };
  }

  /** Uma chamada à MyDHL API, com o erro dela traduzido. */
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const credentials = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString(
      'base64',
    );
    const response = await this.http(`${this.config.baseUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${credentials}`,
        'x-version': API_VERSION,
        'Message-Reference': randomUUID(),
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    }).catch((erro: unknown) => {
      throw new UpstreamError(`A DHL não respondeu: ${erro instanceof Error ? erro.message : erro}`);
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      const detail = String(payload.detail ?? payload.message ?? payload.title ?? response.statusText);
      this.logger.warn(`${method} ${path.split('?')[0]} → ${response.status}: ${detail}`);
      throw new UpstreamError(`DHL: ${detail}`);
    }
    return payload as T;
  }
}

/** Caixa do kit, na falta das medidas do produto (cadastro adm-8). */
export function kitParcel(weightGrams: number): ShippingPackage {
  return { weightGrams, lengthCm: 20, widthCm: 15, heightCm: 6 };
}

/** Próximo dia útil (seg–sex), no fuso de Brasília. A DHL recusa data no passado. */
export function nextBusinessDay(now: Date): { date: string } {
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const day = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate() + 1));
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
  return { date: day.toISOString().slice(0, 10) };
}

function party(p: ShippingParty) {
  const line1 = `${p.street}, ${p.number}`;
  return {
    postalAddress: {
      postalCode: zip(p.zipCode),
      cityName: p.city.slice(0, 45),
      countryCode: 'BR',
      provinceCode: p.state,
      addressLine1: line1.slice(0, 45),
      ...(p.complement ? { addressLine2: p.complement.slice(0, 45) } : {}),
      ...(p.district ? { countyName: p.district.slice(0, 45) } : {}),
    },
    contactInformation: {
      fullName: p.name.slice(0, 255),
      // Obrigatório mesmo para pessoa física: vai o próprio nome.
      companyName: (p.company ?? p.name).slice(0, 100),
      phone: phone(p.phone),
      ...(p.email ? { email: p.email } : {}),
    },
    ...(p.document
      ? { registrationNumbers: [{ typeCode: 'CNP', number: p.document, issuerCountryCode: 'BR' }] }
      : {}),
    typeCode: p.kind,
  };
}

function packageOf(parcel: ShippingPackage) {
  return {
    weight: Number(kg(parcel.weightGrams)),
    dimensions: { length: parcel.lengthCm, width: parcel.widthCm, height: parcel.heightCm },
  };
}

function zip(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function kg(grams: number): string {
  return String(Math.max(Math.round(grams / 10) / 100, 0.1));
}

function phone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
}

/** A DHL só aceita ASCII em alguns campos: tira acento. */
export function ascii(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function productName(raw: string | undefined): string {
  if (!raw) return 'DHL Express';
  const lower = raw.toLowerCase();
  if (lower.includes('12:00')) return 'DHL Express até 12h';
  if (lower.includes('economy')) return 'DHL Econômico';
  return 'DHL Express';
}

interface DhlRatesResponse {
  readonly products?: ReadonlyArray<{
    readonly productCode: string;
    readonly productName?: string;
    readonly totalPrice?: ReadonlyArray<{ readonly currencyType?: string; readonly price?: number }>;
    readonly deliveryCapabilities?: { readonly totalTransitDays?: number };
  }>;
}

interface DhlShipmentResponse {
  readonly shipmentTrackingNumber: string;
  readonly trackingUrl?: string;
  readonly documents?: ReadonlyArray<{
    readonly typeCode?: string;
    readonly imageFormat?: string;
    readonly content: string;
  }>;
}

interface DhlTrackingResponse {
  readonly shipments?: ReadonlyArray<{
    readonly events?: ReadonlyArray<{
      readonly date: string;
      readonly time?: string;
      readonly typeCode?: string;
      readonly description?: string;
      readonly serviceArea?: ReadonlyArray<{ readonly description?: string }>;
    }>;
  }>;
}

interface DhlPickupResponse {
  readonly dispatchConfirmationNumbers?: readonly string[];
  readonly readyByTime?: string;
}
