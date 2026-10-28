import type { ShippingParty } from '../../domain/ports/shipping-provider.port';
import {
  DHL_PRODUCTION_URL,
  DHL_TEST_URL,
  DhlExpressShippingProvider,
  nextBusinessDay,
  type DhlConfig,
} from './dhl-express.shipping.provider';

const lab: ShippingParty = {
  name: 'Recebimento de Amostras',
  company: 'Genoa Biotecnologia S.A.',
  phone: '11937672072',
  document: '07671920000180',
  zipCode: '01228904',
  street: 'Avenida Angélica',
  number: '2318',
  district: 'Consolação',
  city: 'São Paulo',
  state: 'SP',
  kind: 'business',
};

const cliente: ShippingParty = {
  name: 'Maria Silva',
  phone: '(11) 98821-4470',
  email: 'maria@email.com',
  zipCode: '04538-133',
  street: 'Rua Tabapuã',
  number: '100',
  complement: 'Apto 12',
  district: 'Itaim Bibi',
  city: 'São Paulo',
  state: 'SP',
  kind: 'private',
};

function build(baseUrl: string, response: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const http = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response), { status });
  }) as unknown as typeof fetch;
  const config: DhlConfig = {
    baseUrl,
    apiKey: 'chave',
    apiSecret: 'segredo',
    accountNumber: '960000000',
    productCode: 'N',
    labelFormat: 'pdf',
    labelTemplate: 'ECOM26_84_A4_001',
    origin: lab,
    simulationMinutesPerStep: 5,
  };
  // Sexta, 30/10/2026, 15h em Brasília.
  const now = () => new Date('2026-10-30T18:00:00Z');
  return { provider: new DhlExpressShippingProvider(config, http, now), calls };
}

/** GC-AJ-038 a 041 contra o contrato da MyDHL API 3.4.0, com fetch simulado. */
describe('DhlExpressShippingProvider', () => {
  it('cota com conta, origem, destino com cidade, peso e o próximo dia útil', async () => {
    const { provider, calls } = build(DHL_PRODUCTION_URL, {
      products: [
        {
          productCode: 'N',
          productName: 'EXPRESS DOMESTIC',
          totalPrice: [
            { currencyType: 'BASEC', price: 9.5 },
            { currencyType: 'BILLC', price: 48.9 },
          ],
          deliveryCapabilities: { totalTransitDays: 1 },
        },
      ],
    });

    const options = await provider.quote({
      destinationZipCode: '04538133',
      destinationCity: 'São Paulo',
      weightGrams: 180,
    });

    expect(options).toEqual([{ code: 'N', name: 'DHL Express', priceCents: 4890, estimatedDays: 1 }]);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/mydhlapi/rates');
    expect(url.searchParams.get('destinationCityName')).toBe('Sao Paulo');
    expect(url.searchParams.get('destinationPostalCode')).toBe('04538-133');
    expect(url.searchParams.get('plannedShippingDate')).toBe('2026-11-02');
    expect(url.searchParams.get('isCustomsDeclarable')).toBe('false');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('chave:segredo').toString('base64')}`);
    expect(headers['x-version']).toBe('3.4.0');
  });

  it('a volta é um envio comum: cliente remetente, laboratório destinatário, conta da Genoa', async () => {
    const { provider, calls } = build(DHL_TEST_URL, {
      shipmentTrackingNumber: '1234567890',
      documents: [{ typeCode: 'label', imageFormat: 'PDF', content: 'JVBERi0=' }],
    });

    const result = await provider.createLabel({
      orderNumber: 'GC-2026-00042',
      method: 'N',
      destinationZipCode: lab.zipCode,
      reverse: true,
      from: cliente,
      to: lab,
      parcel: { weightGrams: 150, lengthCm: 25, widthCm: 18, heightCm: 3 },
    });

    expect(result).toEqual({
      trackingCode: '1234567890',
      trackingUrl: undefined,
      label: { format: 'PDF', base64: 'JVBERi0=' },
    });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.customerDetails.shipperDetails.contactInformation.companyName).toBe('Maria Silva');
    expect(body.customerDetails.shipperDetails.contactInformation.phone).toBe('+5511988214470');
    expect(body.customerDetails.receiverDetails.registrationNumbers[0].number).toBe('07671920000180');
    expect(body.accounts).toEqual([{ typeCode: 'shipper', number: '960000000' }]);
    expect(body.plannedShippingDateAndTime).toBe('2026-11-02T10:00:00 GMT-03:00');
    expect(body.content.description).toMatch(/^[\x20-\x7E]+$/);
    expect(body.content.packages[0].weight).toBe(0.15);
  });

  it('agenda a coleta ligada ao conhecimento da volta e devolve o protocolo', async () => {
    const { provider, calls } = build(DHL_PRODUCTION_URL, {
      dispatchConfirmationNumbers: ['PRG261103000062'],
      readyByTime: '09:00',
    });

    const result = await provider.schedulePickup({
      orderNumber: 'GC-2026-00042',
      trackingCode: '1234567890',
      date: '2026-11-03',
      readyTime: '09:00',
      closeTime: '12:00',
      location: 'Portaria',
      from: cliente,
      to: lab,
      parcel: { weightGrams: 150, lengthCm: 25, widthCm: 18, heightCm: 3 },
    });

    expect(result.confirmationNumber).toBe('PRG261103000062');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.plannedPickupDateAndTime).toBe('2026-11-03T09:00:00 GMT-03:00');
    expect(body.locationType).toBe('residence');
    expect(body.shipmentDetails[0].shipmentTrackingNumber).toBe('1234567890');
  });

  it('em produção lê os eventos da DHL, em ordem cronológica e com rótulo em português', async () => {
    const { provider } = build(DHL_PRODUCTION_URL, {
      shipments: [
        {
          events: [
            { date: '2026-11-04', time: '09:10:00', typeCode: 'OK', description: 'Delivered' },
            { date: '2026-11-03', time: '15:00:00', typeCode: 'PU', description: 'Shipment picked up' },
          ],
        },
      ],
    });
    const result = await provider.track({
      trackingCode: '1234567890',
      reverse: false,
      createdAt: new Date(),
      pickupAt: null,
    });
    expect(result.events.map((e) => [e.code, e.description])).toEqual([
      ['PU', 'Coletado'],
      ['OK', 'Entregue'],
    ]);
  });

  it('no ambiente de teste simula o rastreio, que a DHL não oferece lá', async () => {
    const { provider, calls } = build(DHL_TEST_URL, {});
    const result = await provider.track({
      trackingCode: '1234567890',
      reverse: false,
      createdAt: new Date('2026-10-30T17:00:00Z'),
      pickupAt: null,
    });
    expect(calls).toHaveLength(0);
    expect(result.events.at(-1)?.code).toBe('OK');
  });

  it('traduz o erro da DHL num erro de dependência externa', async () => {
    const { provider } = build(DHL_PRODUCTION_URL, { detail: 'Invalid postal code' }, 422);
    await expect(
      provider.quote({ destinationZipCode: '00000000', destinationCity: 'X', weightGrams: 180 }),
    ).rejects.toThrow('DHL: Invalid postal code');
  });

  it('próximo dia útil pula o fim de semana', () => {
    expect(nextBusinessDay(new Date('2026-10-30T18:00:00Z')).date).toBe('2026-11-02');
    expect(nextBusinessDay(new Date('2026-11-03T18:00:00Z')).date).toBe('2026-11-04');
  });
});
