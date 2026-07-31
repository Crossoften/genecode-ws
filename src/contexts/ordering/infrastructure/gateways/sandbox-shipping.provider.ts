import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import type {
  LabelRequest,
  ShippingOption,
  ShippingProvider,
  ShippingQuoteRequest,
} from '../../domain/ports/shipping-provider.port';

/**
 * Adapter de sandbox de logística.
 *
 * Cotação determinística por CEP: o mesmo CEP devolve sempre o mesmo preço, o
 * que torna os testes reprodutíveis. O preço cresce com a distância aproximada
 * da região — o primeiro dígito do CEP —, o suficiente para exercitar a tela.
 *
 * As duas modalidades existem porque a decisão F5 manteve o Express: como o
 * frete é pago pelo cliente, faz sentido ele escolher.
 */
@Injectable()
export class SandboxShippingProvider implements ShippingProvider {
  async quote(request: ShippingQuoteRequest): Promise<ShippingOption[]> {
    const zip = request.destinationZipCode.replace(/\D/g, '');
    // Primeiro dígito do CEP indica a região; 0 é São Paulo capital.
    const region = Number(zip[0] ?? '0');
    const base = 1_890 + region * 320;
    const weightFactor = Math.ceil(request.weightGrams / 200) * 90;

    return [
      {
        code: 'STANDARD',
        name: 'Padrão',
        priceCents: base + weightFactor,
        estimatedDays: 6 + region,
      },
      {
        code: 'EXPRESS',
        name: 'Express',
        priceCents: Math.round((base + weightFactor) * 2.1),
        estimatedDays: 2 + Math.floor(region / 3),
      },
    ];
  }

  async createLabel(request: LabelRequest): Promise<{ trackingCode: string }> {
    // Formato dos Correios: 2 letras + 9 dígitos + BR. Derivado por hash para
    // ser estável entre execuções com o mesmo pedido.
    const seed = `${request.orderNumber}${request.reverse ? 'R' : 'O'}`;
    const digits = createHash('sha256').update(seed).digest('hex').replace(/\D/g, '').slice(0, 9);
    return { trackingCode: `${request.reverse ? 'LR' : 'LO'}${digits.padEnd(9, '0')}BR` };
  }
}
