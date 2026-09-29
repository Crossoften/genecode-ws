import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  ChargeRequest,
  ChargeResult,
  PaymentGateway,
} from '../../domain/ports/payment-gateway.port';

/** Centavos que forçam recusa, para exercitar a tela de erro sem adquirente. */
const REFUSAL_TRIGGER_CENTS = 51;

/**
 * Adapter de sandbox do gateway de pagamento.
 *
 * Continua existindo depois da escolha da PagoLivre porque homologação precisa
 * demonstrar a venda inteira — até a fila do laboratório — sem depender da
 * adquirente estar no ar nem de alguém pagar de verdade. É o `PAYMENT_PROVIDER`
 * que decide qual dos dois entra.
 *
 * O que ele simula do modelo real:
 *
 * - **Cartão** aprova na hora (é o atalho que a demonstração precisa), exceto
 *   quando o total termina em `,51`, o que recusa. Sem `cardToken` na porta, o
 *   gatilho passou a ser o valor — mesma ideia do sandbox da bemfácil.
 * - **Pix e boleto** ficam `PENDING` com `redirectUrl`, porque é assim que a
 *   PagoLivre se comporta: a confirmação chega depois, por webhook.
 */
@Injectable()
export class SandboxPaymentGateway implements PaymentGateway {
  private readonly logger = new Logger('SandboxPayment');

  /** Chaveado por número de pedido — é assim que a porta consulta agora. */
  private readonly charges = new Map<string, ChargeResult>();

  /** Marca este adapter como simulado — ver a porta. O gateway real não tem. */
  readonly simulatesFulfillment = true;

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const externalId = `sbx_${randomUUID()}`;
    const result = this.simulate(externalId, request);

    this.charges.set(request.orderNumber, result);

    this.logger.log(
      `${request.method} ${(request.amountCents / 100).toFixed(2)} → ${result.status}` +
        (request.split?.length ? ` (split com ${request.split.length})` : ''),
    );

    return result;
  }

  async fetchStatus(orderNumber: string): Promise<ChargeResult> {
    return (
      this.charges.get(orderNumber) ?? {
        externalId: orderNumber,
        status: 'REFUSED',
        failureReason: 'Cobrança não encontrada.',
      }
    );
  }

  async refund(externalId: string): Promise<void> {
    this.logger.log(`estorno de ${externalId}`);
    for (const [orderNumber, charge] of this.charges) {
      if (charge.externalId === externalId) this.charges.delete(orderNumber);
    }
  }

  private simulate(externalId: string, request: ChargeRequest): ChargeResult {
    if (request.amountCents % 100 === REFUSAL_TRIGGER_CENTS) {
      return { externalId, status: 'REFUSED', failureReason: 'Cartão recusado pelo emissor.' };
    }

    if (request.method === 'CREDIT_CARD') {
      return { externalId, status: 'PAID' };
    }

    // Pix expira em 30 minutos; boleto em 3 dias — o mesmo prazo de expiração
    // que a PagoLivre aplica às ordens dela.
    const minutes = request.method === 'PIX' ? 30 : 3 * 24 * 60;
    return {
      externalId,
      status: 'PENDING',
      redirectUrl: `https://sandbox.local/checkout/${externalId}`,
      expiresAt: new Date(Date.now() + minutes * 60_000),
    };
  }
}
