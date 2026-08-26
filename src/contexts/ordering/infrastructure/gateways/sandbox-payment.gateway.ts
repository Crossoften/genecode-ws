import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  ChargeRequest,
  ChargeResult,
  PaymentGateway,
} from '../../domain/ports/payment-gateway.port';

/**
 * Adapter de sandbox do gateway de pagamento.
 *
 * Existe porque a adquirente ainda não foi escolhida. Simula os caminhos que o
 * checkout precisa exercitar de verdade, e não só o caminho feliz:
 *
 * - **Cartão** aprova, exceto quando o token começa com `refuse_`, o que permite
 *   testar a tela de recusa sem depender de dado de teste da adquirente.
 * - **Pix** e **boleto** ficam `PENDING` com código e validade, porque é assim
 *   que funcionam: a confirmação chega depois, por webhook.
 *
 * O comportamento assíncrono é o que mais importa reproduzir. Se o checkout for
 * escrito assumindo confirmação imediata, trocar pelo adapter real quebra o
 * fluxo inteiro.
 */
@Injectable()
export class SandboxPaymentGateway implements PaymentGateway {
  private readonly logger = new Logger('SandboxPayment');
  private readonly charges = new Map<string, ChargeResult>();

  /** Marca este adapter como simulado — ver a porta. O gateway real não terá. */
  readonly simulatesFulfillment = true;

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const externalId = `sbx_${randomUUID()}`;

    const result = this.simulate(externalId, request);
    this.charges.set(externalId, result);

    this.logger.log(
      `${request.method} ${(request.amountCents / 100).toFixed(2)} → ${result.status}` +
        (request.split ? ` (split ${(request.split.amountCents / 100).toFixed(2)})` : ''),
    );

    return result;
  }

  async fetchStatus(externalId: string): Promise<ChargeResult> {
    const known = this.charges.get(externalId);
    if (known) return known;
    return { externalId, status: 'REFUSED', failureReason: 'Cobrança não encontrada.' };
  }

  async refund(externalId: string): Promise<void> {
    this.logger.log(`estorno de ${externalId}`);
    this.charges.delete(externalId);
  }

  private simulate(externalId: string, request: ChargeRequest): ChargeResult {
    if (request.method === 'CREDIT_CARD') {
      if (request.cardToken?.startsWith('refuse_')) {
        return { externalId, status: 'REFUSED', failureReason: 'Cartão recusado pelo emissor.' };
      }
      if (!request.cardToken) {
        return { externalId, status: 'REFUSED', failureReason: 'Token do cartão ausente.' };
      }
      return { externalId, status: 'PAID' };
    }

    // Pix expira em 30 minutos; boleto, em 3 dias úteis — aproximados aqui.
    const minutes = request.method === 'PIX' ? 30 : 3 * 24 * 60;
    return {
      externalId,
      status: 'PENDING',
      paymentCode:
        request.method === 'PIX'
          ? `00020126SANDBOX${externalId.slice(-8).toUpperCase()}`
          : `34191.79001 01043.510047 91020.150008 1 ${externalId.slice(-10)}`,
      expiresAt: new Date(Date.now() + minutes * 60_000),
    };
  }
}
