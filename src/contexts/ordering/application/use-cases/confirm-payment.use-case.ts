import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infra/database/prisma.service';

/**
 * Confirma o pagamento de um pedido: marca como pago, registra o evento e abre
 * o repasse do parceiro.
 *
 * ### Por que isto saiu do checkout
 *
 * Com a adquirente real, **o checkout não sabe mais se o pedido foi pago**. Ele
 * cria a cobrança e devolve uma URL; a confirmação chega depois, por webhook —
 * ou por reconciliação, quando o webhook falha. São três caminhos de entrada
 * para o mesmo desfecho, e um desfecho com três donos precisa morar num lugar só.
 *
 * ### Idempotência
 *
 * Os três caminhos podem disparar para o mesmo pedido, e a própria PagoLivre
 * avisa que as notificações podem chegar **fora de ordem** e repetidas. Por isso
 * a primeira coisa que este caso de uso faz é verificar se o pedido já está
 * pago, e a criação do repasse é um `upsert` na chave `orderId`: reprocessar não
 * paga o parceiro duas vezes.
 */
@Injectable()
export class ConfirmPaymentUseCase {
  private readonly logger = new Logger(ConfirmPaymentUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param orderId - Id interno do pedido.
   * @returns `true` quando esta chamada foi a que confirmou; `false` quando o
   *   pedido já estava pago (repetição benigna).
   */
  async execute(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { number: true, status: true, couponCode: true, commissionCents: true },
    });

    if (order.status === 'PAID') {
      this.logger.debug(`Pedido ${order.number} já estava pago — nada a fazer.`);
      return false;
    }

    // Sem cupom não há parceiro; sem comissão não há o que repassar.
    const partner =
      order.couponCode && (order.commissionCents ?? 0) > 0
        ? await this.prisma.partner.findUnique({
            where: { couponCode: order.couponCode },
            select: { id: true },
          })
        : null;

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'PAID', paidAt: new Date() },
      }),
      this.prisma.payment.updateMany({
        where: { orderId },
        data: { status: 'PAID', confirmedAt: new Date() },
      }),
      this.prisma.orderEvent.create({
        data: { orderId, status: 'PAID', actor: 'system', note: 'Pagamento confirmado.' },
      }),
      ...(partner
        ? [
            this.prisma.payout.upsert({
              where: { orderId },
              // O split acontece na adquirente; este registro é o que permite ao
              // parceiro conferir e ao admin fechar o mês. Nasce PENDING porque
              // a liquidação é da adquirente, não nossa.
              create: {
                partnerId: partner.id,
                orderId,
                orderNumber: order.number,
                amountCents: order.commissionCents!,
              },
              update: {},
            }),
          ]
        : []),
    ]);

    this.logger.log(`Pedido ${order.number} confirmado como pago.`);
    return true;
  }
}
