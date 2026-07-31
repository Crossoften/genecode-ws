import { Inject, Injectable } from '@nestjs/common';

import { ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import {
  SHIPPING_PROVIDER,
  type ShippingOption,
  type ShippingProvider,
} from '../../domain/ports/shipping-provider.port';

/** Peso aproximado do kit de coleta. */
const KIT_WEIGHT_GRAMS = 180;

/**
 * Cota o frete para um CEP.
 *
 * Existe como caso de uso separado porque a tela cota antes de o cliente
 * preencher o resto — ele digita o CEP e vê as opções na hora, como no protótipo
 * aprovado.
 */
@Injectable()
export class QuoteShippingUseCase {
  constructor(@Inject(SHIPPING_PROVIDER) private readonly shipping: ShippingProvider) {}

  async execute(zipCode: string): Promise<Result<ShippingOption[]>> {
    const digits = zipCode.replace(/\D/g, '');
    if (digits.length !== 8) {
      return fail(new ValidationError('CEP inválido.', { field: 'zipCode' }));
    }

    const options = await this.shipping.quote({
      destinationZipCode: digits,
      weightGrams: KIT_WEIGHT_GRAMS,
    });

    return ok(options);
  }
}
