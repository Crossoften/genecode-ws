export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export type PaymentMethod = 'CREDIT_CARD' | 'PIX' | 'BOLETO';

/**
 * Um recebedor do split.
 *
 * `merchantRef` é o identificador da unidade **na adquirente** — não o código do
 * cupom. Na PagoLivre é um GUID de unidade cadastrada; um cupom não é aceito.
 * O de-para mora em `Coupon.splitMerchantId`.
 */
export interface SplitRecipient {
  readonly merchantRef: string;
  readonly amountCents: number;
}

export interface ChargeRequest {
  readonly orderNumber: string;
  readonly amountCents: number;
  readonly method: PaymentMethod;
  readonly installments: number;
  readonly customer: {
    readonly name: string;
    readonly email: string;
    readonly document: string;
    /**
     * Obrigatório na PagoLivre, apesar de a doc dela dizer que basta CPF **ou**
     * celular: sem telefone a página de pagamento abre e trava.
     */
    readonly phone: string;
  };
  /**
   * Divisão do valor entre parceiros.
   *
   * Lista, não um só: a PagoLivre aceita N recebedores por cobrança, e o modelo
   * do GeneCode prevê mais de um parceiro na mesma venda.
   */
  readonly split?: readonly SplitRecipient[];
}

export type ChargeStatus = 'PENDING' | 'AUTHORIZED' | 'PAID' | 'REFUSED' | 'CANCELED' | 'EXPIRED';

export interface ChargeResult {
  readonly externalId: string;
  readonly status: ChargeStatus;
  /**
   * Para onde mandar o comprador para pagar.
   *
   * É o coração do modelo hospedado: a cobrança nasce `PENDING` e só vira `PAID`
   * quando o webhook avisar. Quem consome não pode assumir confirmação síncrona.
   */
  readonly redirectUrl?: string;
  readonly failureReason?: string;
  readonly expiresAt?: Date;
}

/**
 * Porta do gateway de pagamento.
 *
 * ### Por que não existe `cardToken` aqui
 *
 * A porta original previa checkout transparente — tela nossa, cartão tokenizado
 * no navegador pelo SDK da adquirente. **A PagoLivre não oferece isso.** A
 * leitura completa da API v2 (24/09/2026) não encontrou SDK de tokenização,
 * endpoint de tokenização nem iframe embutível: o único caminho é redirecionar
 * para a página da Afinz. Ver `docs/11-pagamento/pagolivre/README.md`.
 *
 * O efeito colateral é bom: o número do cartão nunca toca este servidor, e o
 * escopo PCI fica em **SAQ A** — o mais leve que existe. O estudo anterior
 * (Asaas) levava a SAQ D porque o PAN passaria por aqui.
 *
 * ### O que a troca de adquirente ainda protege
 *
 * A porta continua escondendo a adquirente do caso de uso. O que mudou é o
 * *formato* do desfecho: em vez de "pago ou recusado", `charge()` devolve uma
 * URL. Qualquer adquirente de checkout hospedado encaixa sem tocar no caso de
 * uso — e uma que ofereça checkout transparente também, bastando devolver
 * `status: 'PAID'` direto e `redirectUrl` vazio.
 */
export interface PaymentGateway {
  /**
   * Cria a cobrança na adquirente.
   *
   * Deve ser idempotente por `orderNumber`: uma segunda chamada para o mesmo
   * pedido não pode gerar cobrança duplicada.
   */
  charge(request: ChargeRequest): Promise<ChargeResult>;

  /**
   * Confirma o estado atual de uma cobrança.
   *
   * É a reconciliação para quando o webhook falha — e, no modelo hospedado, o
   * webhook é a única forma de saber que houve pagamento, então esta consulta
   * deixa de ser luxo e vira rede de segurança obrigatória.
   */
  fetchStatus(orderNumber: string): Promise<ChargeResult>;

  /** Estorna/cancela, total ou parcialmente. */
  refund(externalId: string, amountCents?: number): Promise<void>;

  /**
   * Só o adapter de sandbox define isto como `true`.
   *
   * Enquanto a adquirente real não está ligada, o checkout **adianta** o pedido
   * pago até a fila do laboratório para demonstrar o fluxo completo em
   * homologação. O adapter real não tem a flag, então o adiantamento — o "mock"
   * — desaparece sozinho ao trocar o gateway.
   */
  readonly simulatesFulfillment?: boolean;
}
