import type {
  LabelRequest,
  LabelResult,
  PickupRequest,
  PickupResult,
  ShippingOption,
  ShippingProvider,
  TrackingResult,
  TrackRequest,
} from '../../domain/ports/shipping-provider.port';

/** Código da única modalidade quando o frete é fixo. */
export const FLAT_RATE_CODE = 'FIXO';

/**
 * Frete único para o Brasil inteiro (GC-N05-09).
 *
 * Decidido em 05/11: o comprador paga R$ 29,90 para qualquer CEP e a Genoa
 * absorve a diferença ("Manaus vai custar mais caro que São Paulo? Sim, e a
 * gente vai absorver nesse primeiro momento"). Some a escolha entre Padrão e
 * Express e some o cálculo exibido.
 *
 * É um embrulho e não um provedor novo porque só a **cotação** muda:
 * etiqueta, rastreio e retirada continuam com quem estiver por baixo (manual,
 * sandbox ou DHL). A cotação é a mesma que o checkout refaz no servidor, então
 * o preço cobrado não depende do que a tela mandar.
 */
export class FlatRateShippingProvider implements ShippingProvider {
  constructor(
    private readonly inner: ShippingProvider,
    private readonly priceCents: number,
    private readonly estimatedDays: number,
  ) {}

  async quote(): Promise<ShippingOption[]> {
    return [
      {
        code: FLAT_RATE_CODE,
        name: 'Envio do kit',
        priceCents: this.priceCents,
        estimatedDays: this.estimatedDays,
      },
    ];
  }

  createLabel(request: LabelRequest): Promise<LabelResult> {
    return this.inner.createLabel(request);
  }

  track(request: TrackRequest): Promise<TrackingResult> {
    return this.inner.track(request);
  }

  schedulePickup(request: PickupRequest): Promise<PickupResult> {
    return this.inner.schedulePickup(request);
  }
}
