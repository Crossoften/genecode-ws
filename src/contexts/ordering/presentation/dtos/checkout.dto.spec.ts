import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CheckoutDto } from './checkout.dto';

/**
 * GC-N05-09: com o frete único, a única modalidade é `FIXO`. O DTO ainda só
 * aceitava STANDARD/EXPRESS e a compra parava em "Pagar agora" — achado na
 * captura das evidências de 08/11.
 */
describe('CheckoutDto · modalidade de envio', () => {
  const erros = (shippingCode: string) =>
    validateSync(plainToInstance(CheckoutDto, { shippingCode }), {
      skipMissingProperties: false,
    }).filter((erro) => erro.property === 'shippingCode');

  it.each(['FIXO', 'STANDARD', 'EXPRESS'])('aceita %s', (codigo) => {
    expect(erros(codigo)).toHaveLength(0);
  });

  it('recusa modalidade inventada', () => {
    expect(erros('GRATIS')).not.toHaveLength(0);
  });
});
