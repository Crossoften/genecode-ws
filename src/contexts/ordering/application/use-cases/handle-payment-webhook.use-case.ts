import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

import { PAYMENT_GATEWAY, type PaymentGateway } from '../../domain/ports/payment-gateway.port';
import { ConfirmPaymentUseCase } from './confirm-payment.use-case';

export interface PaymentWebhookEvent {
  readonly eventName?: string;
  /** Identificador do pedido no GeneCode — é o nosso `order.number`. */
  readonly orderKey?: string;
  /** Identificador da ordem na adquirente. */
  readonly orderId?: string;
}

/**
 * Processa uma notificação da adquirente.
 *
 * ### A regra que manda aqui: não acreditar no corpo
 *
 * A própria PagoLivre documenta que as notificações de uma mesma entidade podem
 * chegar **fora de ordem**, e a única autenticação do callback é um token na
 * query string — não há assinatura sobre o corpo. Um payload fora de ordem
 * regrediria um pedido pago; um payload forjado o marcaria pago sem pagamento.
 *
 * Por isso o corpo é usado **só para saber qual pedido olhar**. O estado vem de
 * uma consulta nova à adquirente, que é a fonte da verdade.
 */
@Injectable()
export class HandlePaymentWebhookUseCase {
  private readonly logger = new Logger(HandlePaymentWebhookUseCase.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly confirmPayment: ConfirmPaymentUseCase,
    private readonly prisma: PrismaService,
  ) {}

  async execute(event: PaymentWebhookEvent): Promise<void> {
    const orderNumber = event.orderKey;

    if (!orderNumber) {
      // Sem o nosso identificador não há como saber de que pedido se trata.
      // Responder 200 mesmo assim é proposital: reenviar não resolveria, e a
      // PagoLivre tentaria dez vezes de graça.
      this.logger.warn(`Evento ${event.eventName ?? '?'} sem orderKey — ignorado.`);
      return;
    }

    const order = await this.prisma.order.findUnique({
      where: { number: orderNumber },
      select: { id: true, status: true },
    });

    if (!order) {
      this.logger.warn(`Evento para pedido desconhecido ${orderNumber} — ignorado.`);
      return;
    }

    const charge = await this.gateway.fetchStatus(orderNumber);

    this.logger.log(
      `Evento ${event.eventName ?? '?'} do pedido ${orderNumber}: ` +
        `adquirente diz ${charge.status} (local ${order.status}).`,
    );

    switch (charge.status) {
      case 'PAID':
      case 'AUTHORIZED':
        // `AUTHORIZED` conta como sucesso: a doc da PagoLivre diz explicitamente
        // que autorizado sem captura "deve ser considerado como pagamento com
        // sucesso", e a captura acontece depois, do lado deles.
        await this.confirmPayment.execute(order.id);
        break;

      case 'REFUSED':
      case 'CANCELED':
      case 'EXPIRED':
        await this.registerFailure(order.id, order.status, charge.status, charge.failureReason);
        break;

      case 'PENDING':
        // Nada a fazer: é o estado em que o pedido já nasceu.
        break;
    }
  }

  /**
   * Registra recusa, cancelamento ou expiração.
   *
   * Nunca rebaixa um pedido já pago. Um evento atrasado de "expirado" chegando
   * depois da confirmação tiraria do cliente uma compra que ele fez — e este é
   * exatamente o cenário de entrega fora de ordem que a doc avisa existir.
   */
  private async registerFailure(
    orderId: string,
    currentStatus: string,
    charge: 'REFUSED' | 'CANCELED' | 'EXPIRED',
    reason?: string,
  ): Promise<void> {
    if (currentStatus === 'PAID') {
      this.logger.warn(`Pedido já pago recebeu ${charge} — ignorado para não regredir.`);
      return;
    }

    // `OrderStatus` não tem EXPIRED: expirar sem pagar encerra o pedido como
    // CANCELLED, e o motivo fica no evento da linha do tempo. `PaymentStatus`,
    // esse sim, distingue expirado de recusado — é onde a diferença importa.
    const orderStatus = 'CANCELLED' as const;
    const note =
      charge === 'REFUSED'
        ? `Pagamento recusado. ${reason ?? ''}`.trim()
        : charge === 'EXPIRED'
          ? 'Cobrança expirou sem pagamento.'
          : `Cobrança cancelada. ${reason ?? ''}`.trim();

    await this.prisma.$transaction([
      this.prisma.order.update({ where: { id: orderId }, data: { status: orderStatus } }),
      this.prisma.payment.updateMany({
        where: { orderId },
        data: {
          status: charge === 'REFUSED' ? 'REFUSED' : charge === 'EXPIRED' ? 'EXPIRED' : 'REFUNDED',
          failureReason: reason?.slice(0, 255),
        },
      }),
      this.prisma.orderEvent.create({
        data: { orderId, status: orderStatus, actor: 'system', note },
      }),
    ]);
  }
}
