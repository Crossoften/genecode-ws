import { ConflictError } from '@shared/domain/domain-error';

import { FLAT_RATE_CODE, FlatRateShippingProvider } from './flat-rate.shipping.provider';
import { ManualShippingProvider } from './manual-shipping.provider';
import { SandboxShippingProvider } from './sandbox-shipping.provider';

describe('Frete único e envio manual (GC-N05-09/10)', () => {
  const party = {
    name: 'Fulana',
    phone: '11999990000',
    zipCode: '69005000',
    street: 'Rua A',
    number: '1',
    city: 'Manaus',
    state: 'AM',
    kind: 'private' as const,
  };

  it('cobra R$ 29,90 em qualquer CEP, numa única modalidade', async () => {
    const flat = new FlatRateShippingProvider(new ManualShippingProvider(), 2990, 10);

    for (const zip of ['01228904', '69005000', '86010000']) {
      const options = await flat.quote();
      expect(options).toEqual([
        { code: FLAT_RATE_CODE, name: 'Envio do kit', priceCents: 2990, estimatedDays: 10 },
      ]);
      expect(zip).toHaveLength(8);
    }
  });

  it('deixa etiqueta e rastreio com a transportadora de baixo', async () => {
    const flat = new FlatRateShippingProvider(new SandboxShippingProvider(), 2990, 10);
    const label = await flat.createLabel({
      orderNumber: 'GC-2026-00001',
      method: FLAT_RATE_CODE,
      destinationZipCode: party.zipCode,
      from: party,
      to: party,
    });
    expect(label.trackingCode).toMatch(/^LO\d{9}BR$/);
  });

  it('no envio manual não emite etiqueta nem agenda retirada', async () => {
    const manual = new ManualShippingProvider();
    await expect(manual.createLabel()).rejects.toBeInstanceOf(ConflictError);
    await expect(manual.schedulePickup()).rejects.toBeInstanceOf(ConflictError);
    expect(await manual.quote()).toEqual([]);
  });

  it('no envio manual o rastreio não inventa eventos', async () => {
    const result = await new ManualShippingProvider().track({
      trackingCode: 'AB123456789BR',
      reverse: false,
      createdAt: new Date(),
      pickupAt: null,
    });
    expect(result).toEqual({ trackingCode: 'AB123456789BR', events: [] });
  });
});
