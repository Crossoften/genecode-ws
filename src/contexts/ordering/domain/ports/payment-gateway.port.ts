export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export type PaymentMethod = 'CREDIT_CARD' | 'PIX' | 'BOLETO';

export interface ChargeRequest {
  readonly orderNumber: string;
  readonly amountCents: number;
  readonly method: PaymentMethod;
  readonly installments: number;
  readonly customer: {
    readonly name: string;
    readonly email: string;
    readonly document: string;
  };
  /**
   * Token do cartão, gerado no navegador pelo SDK da adquirente.
   *
   * Nunca o número do cartão. É isso que mantém o checkout transparente — tela
   * 100% nossa — sem que dado de cartão passe pelo nosso servidor, e o escopo de
   * PCI em SAQ-A-EP em vez da certificação completa.
   */
  readonly cardToken?: string;
  /** Split de comissão do parceiro, quando houver cupom. */
  readonly split?: { readonly recipientRef: string; readonly amountCents: number };
}

export interface ChargeResult {
  readonly externalId: string;
  readonly status: 'AUTHORIZED' | 'PAID' | 'REFUSED' | 'PENDING';
  readonly failureReason?: string;
  /** Copia e cola do Pix ou linha digitável do boleto. */
  readonly paymentCode?: string;
  readonly expiresAt?: Date;
}

/**
 * Porta do gateway de pagamento.
 *
 * A adquirente **ainda não foi escolhida** — o cliente cogitou Fins em 01/06 e
 * Mercado Pago em 16/07, e pediu explicitamente em 22/06 para não integrar API
 * antes de bater o martelo: *"pode montar layout bonitinho, mas ainda não faz a
 * integração de API"*.
 *
 * Com a porta definida, o checkout inteiro é construído e testado contra um
 * adapter de sandbox. Quando a decisão vier, escrever o adapter real não toca
 * em nenhuma outra linha do sistema.
 */
export interface PaymentGateway {
  /** Cria a cobrança. */
  charge(request: ChargeRequest): Promise<ChargeResult>;

  /**
   * Confirma o estado atual de uma cobrança.
   *
   * Pix e boleto são assíncronos: a confirmação chega por webhook, e este método
   * é a reconciliação para quando o webhook falha.
   */
  fetchStatus(externalId: string): Promise<ChargeResult>;

  /** Estorna, total ou parcialmente. */
  refund(externalId: string, amountCents?: number): Promise<void>;

  /**
   * Só o adapter de sandbox define isto como `true`.
   *
   * Enquanto a adquirente real não é ligada, o checkout **adianta** o pedido
   * pago até a fila do laboratório (cria o kit e o titular) para demonstrar o
   * fluxo completo em homologação. O adapter real não terá esta flag, então o
   * adiantamento — o "mock" — desaparece sozinho ao trocar o gateway.
   */
  readonly simulatesFulfillment?: boolean;
}
