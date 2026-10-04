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
      select: {
        number: true,
        status: true,
        couponCode: true,
        commissionCents: true,
        splitPlan: true,
      },
    });

    if (order.status === 'PAID') {
      this.logger.debug(`Pedido ${order.number} já estava pago — nada a fazer.`);
      return false;
    }

    // Os repasses nascem do plano congelado no checkout, não de um cálculo novo.
    //
    // Recalcular aqui abriria a janela de a rede ter mudado entre o checkout e a
    // confirmação — e o repasse divergiria do que a adquirente já dividiu, sem
    // ninguém perceber, porque o split dela é write-only.
    const plano = lerPlanoDeSplit(order.splitPlan);

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
      // Um repasse por parceiro da cadeia. O split acontece na adquirente; estes
      // registros são o que permite ao parceiro conferir e ao admin fechar o
      // mês. Nascem PENDING porque a liquidação é da adquirente, não nossa —
      // exceto os que não entraram no split, que são trabalho manual e ficam
      // marcados com `viaSplit: false`.
      ...plano.map((fatia) =>
        this.prisma.payout.upsert({
          where: { orderId_partnerId: { orderId, partnerId: fatia.partnerId } },
          create: {
            partnerId: fatia.partnerId,
            orderId,
            orderNumber: order.number,
            amountCents: fatia.amountCents,
            level: fatia.level,
            sharePercent: fatia.sharePercent,
            viaSplit: fatia.viaSplit,
          },
          update: {},
        }),
      ),
    ]);

    this.logger.log(`Pedido ${order.number} confirmado como pago.`);
    return true;
  }
}

/** Uma fatia do plano de split, como foi congelada no pedido. */
interface FatiaDoPlano {
  readonly partnerId: string;
  readonly level: number;
  readonly sharePercent: number;
  readonly amountCents: number;
  readonly viaSplit: boolean;
}

/**
 * Lê o plano gravado no pedido, conferindo o formato.
 *
 * O campo é JSON no banco, então o que volta não tem tipo garantido: um plano
 * meio gravado produziria `Payout` com valor `undefined`. Linha que não bate
 * com o formato é descartada, e o que sobra é o que vira repasse.
 */
function lerPlanoDeSplit(bruto: unknown): readonly FatiaDoPlano[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.filter(
    (f): f is FatiaDoPlano =>
      typeof f === 'object' &&
      f !== null &&
      typeof (f as FatiaDoPlano).partnerId === 'string' &&
      Number.isInteger((f as FatiaDoPlano).amountCents) &&
      (f as FatiaDoPlano).amountCents > 0 &&
      Number.isInteger((f as FatiaDoPlano).level) &&
      typeof (f as FatiaDoPlano).sharePercent === 'number' &&
      typeof (f as FatiaDoPlano).viaSplit === 'boolean',
  );
}
