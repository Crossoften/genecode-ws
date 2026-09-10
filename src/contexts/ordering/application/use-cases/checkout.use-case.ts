import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';

import { buildActivationCode } from '@contexts/lab/domain/activation-code';
import { PrismaService } from '@infra/database/prisma.service';
import { ConflictError, ValidationError } from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import { calculateTotals, formatOrderNumber, type PricedItem } from '../../domain/order-pricing';
import { OrderStatus } from '../../domain/order-status';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
  type PaymentMethod,
} from '../../domain/ports/payment-gateway.port';
import {
  SHIPPING_PROVIDER,
  type ShippingProvider,
} from '../../domain/ports/shipping-provider.port';

export interface CheckoutInput {
  readonly customer: {
    readonly name: string;
    readonly email: string;
    readonly document: string;
    readonly phone?: string;
  };
  readonly address: {
    readonly zipCode: string;
    readonly street: string;
    readonly number: string;
    readonly complement?: string;
    readonly neighborhood: string;
    readonly city: string;
    readonly state: string;
  };
  readonly items: readonly { readonly productSlug: string; readonly quantity: number }[];
  readonly shippingCode: string;
  readonly couponCode?: string;
  readonly payment: {
    readonly method: PaymentMethod;
    readonly installments: number;
    readonly cardToken?: string;
  };
  /** Conta logada, quando houver. O checkout também funciona anônimo. */
  readonly userId?: string;
}

export interface CheckoutOutput {
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly totalCents: number;
  readonly paymentStatus: string;
  /** Copia e cola do Pix ou linha digitável do boleto. */
  readonly paymentCode?: string;
  readonly expiresAt?: Date;
  readonly failureReason?: string;
  /** True enquanto o pagamento é simulado (sandbox) — some com a adquirente real. */
  readonly simulated: boolean;
}

/** Peso aproximado do kit, para cotação de frete. */
const KIT_WEIGHT_GRAMS = 180;

/** Espaço de bases do código de kit: 6 dígitos, igual ao do gerador de lotes. */
const KIT_BASE_SPACE = 1_000_000;

/**
 * Fecha o pedido: valida, precifica, cobra e persiste.
 *
 * ### Por que o pedido é criado antes da cobrança
 *
 * Se a cobrança viesse primeiro, uma falha entre ela e a gravação deixaria
 * dinheiro cobrado sem pedido no sistema — o pior desfecho possível, porque o
 * cliente pagou e não existe registro para atendê-lo.
 *
 * Criando o pedido primeiro em `PENDING_PAYMENT`, o pior caso é um pedido órfão
 * sem pagamento, que a operação vê, entende e cancela.
 *
 * ### Checkout anônimo
 *
 * `userId` é opcional porque o cliente definiu em 28/05 que a conta é oferecida
 * **depois** da confirmação do pedido. Os dados do comprador ficam congelados no
 * pedido, e a conta é vinculada quando for criada.
 */
@Injectable()
export class CheckoutUseCase {
  private readonly logger = new Logger(CheckoutUseCase.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(SHIPPING_PROVIDER) private readonly shipping: ShippingProvider,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: CheckoutInput): Promise<Result<CheckoutOutput>> {
    if (input.items.length === 0) {
      return fail(new ValidationError('O carrinho está vazio.'));
    }

    const items = await this.priceItems(input.items, input.payment.installments);
    if (items.isFail()) return fail(items.error);

    const shippingOption = await this.resolveShipping(input.address.zipCode, input.shippingCode);
    if (shippingOption.isFail()) return fail(shippingOption.error);

    const coupon = await this.resolveCoupon(input.couponCode);
    if (coupon.isFail()) return fail(coupon.error);

    const totals = calculateTotals(items.value, shippingOption.value.priceCents, coupon.value);

    const order = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextOrderNumber(tx);

      const created = await tx.order.create({
        data: {
          number,
          userId: input.userId,
          customerName: input.customer.name,
          customerEmail: input.customer.email.toLowerCase(),
          customerDoc: input.customer.document,
          customerPhone: input.customer.phone,
          status: 'PENDING_PAYMENT',
          subtotalCents: totals.subtotalCents,
          discountCents: totals.discountCents,
          shippingCents: totals.shippingCents,
          totalCents: totals.totalCents,
          couponCode: coupon.value?.code,
          commissionRate: totals.commissionRate,
          commissionCents: totals.commissionCents,
          shippingMethod: shippingOption.value.code,
          items: { create: items.value.map((item) => ({ ...item })) },
          address: { create: { ...input.address } },
          events: {
            create: { status: 'PENDING_PAYMENT', actor: 'system', note: 'Pedido criado.' },
          },
        },
      });

      if (coupon.value) {
        await tx.coupon.update({
          where: { code: coupon.value.code },
          data: { usedCount: { increment: 1 } },
        });
      }

      return created;
    });

    const charge = await this.gateway.charge({
      orderNumber: order.number,
      amountCents: totals.totalCents,
      method: input.payment.method,
      installments: input.payment.installments,
      customer: input.customer,
      cardToken: input.payment.cardToken,
      split:
        totals.commissionCents && coupon.value
          ? { recipientRef: coupon.value.code, amountCents: totals.commissionCents }
          : undefined,
    });

    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        method: input.payment.method,
        status: charge.status === 'AUTHORIZED' ? 'AUTHORIZED' : charge.status,
        amountCents: totals.totalCents,
        externalId: charge.externalId,
        failureReason: charge.failureReason,
        installments: input.payment.installments,
        confirmedAt: charge.status === 'PAID' ? new Date() : undefined,
      },
    });

    let finalStatus = charge.status === 'PAID' ? OrderStatus.PAID : OrderStatus.PENDING_PAYMENT;
    const simulated = this.gateway.simulatesFulfillment === true;

    if (charge.status === 'PAID') {
      await this.markPaid(order.id);

      // Enquanto a adquirente real não é ligada, o sandbox adianta o pedido até
      // a fila do laboratório para demonstrar o fluxo completo. Desaparece
      // sozinho quando o gateway real (sem a flag) assumir.
      if (simulated) {
        await this.simulateFulfillment(order.id, input.userId);
        finalStatus = OrderStatus.SAMPLE_RECEIVED;
      }
    }

    this.logger.log(`Pedido ${order.number}: ${charge.status}${simulated ? ' (simulado)' : ''}`);

    return ok({
      orderNumber: order.number,
      status: finalStatus,
      totalCents: totals.totalCents,
      paymentStatus: charge.status,
      paymentCode: charge.paymentCode,
      expiresAt: charge.expiresAt,
      failureReason: charge.failureReason,
      simulated,
    });
  }

  /**
   * Adianta o pedido pago até a fila do laboratório — só no fluxo simulado.
   *
   * Cria um titular (com `externalCode`, que o CSV do laboratório casa), vincula
   * ao comprador quando logado, ativa um kit e leva o pedido a `SAMPLE_RECEIVED`,
   * pulando as etapas manuais de envio e coleta. É assim que o laboratório passa
   * a ver a amostra na fila logo após o "pagamento", fechando o fluxo de ponta a
   * ponta em homologação.
   */
  private async simulateFulfillment(orderId: string, userId?: string): Promise<void> {
    const code = await this.uniqueKitCode();

    const batch = await this.prisma.kitBatch.upsert({
      where: { reference: 'SIMULACAO' },
      update: {},
      create: { reference: 'SIMULACAO', notes: 'Fluxo simulado do checkout (sandbox).' },
    });

    const subject = await this.prisma.subject.create({ data: { externalCode: code } });

    if (userId) {
      await this.prisma.subjectLink.upsert({
        where: { userId_subjectId: { userId, subjectId: subject.id } },
        update: {},
        create: { userId, subjectId: subject.id, relation: 'SELF' },
      });
    }

    await this.prisma.kit.create({
      data: {
        code,
        batchId: batch.id,
        status: 'ACTIVATED',
        orderId,
        subjectId: subject.id,
        activatedByUserId: userId,
        activatedAt: new Date(),
      },
    });

    const steps = ['KIT_SHIPPED', 'KIT_DELIVERED', 'SAMPLE_IN_TRANSIT', 'SAMPLE_RECEIVED'] as const;
    await this.prisma.$transaction([
      ...steps.map((status) =>
        this.prisma.orderEvent.create({
          data: { orderId, status, actor: 'system', note: 'Fluxo simulado (homologação).' },
        }),
      ),
      this.prisma.order.update({ where: { id: orderId }, data: { status: 'SAMPLE_RECEIVED' } }),
    ]);
  }

  /**
   * Código de kit válido no módulo 11 e inédito na base.
   *
   * O cálculo é o do domínio (`buildActivationCode`). Havia aqui uma segunda
   * implementação da mesma regra, escrita no dialeto do CPF (`(soma * 10) % 11`
   * em vez de `11 - resto`): as duas são equivalentes — conferidas nas 1.000.000
   * de bases possíveis, zero divergência —, mas duas cópias da mesma regra é o
   * que faz uma delas mudar sozinha um dia, e no dia em que mudar o kit criado
   * aqui deixa de passar na ativação. Removida em 09/09.
   *
   * `randomInt` do `crypto` em vez de `Math.random` pelo mesmo motivo do gerador
   * de lotes: código de kit adivinhável é kit sequestrável.
   */
  private async uniqueKitCode(): Promise<string> {
    for (;;) {
      const code = buildActivationCode(String(randomInt(KIT_BASE_SPACE)).padStart(6, '0'));
      if (!(await this.prisma.kit.findUnique({ where: { code } }))) return code;
    }
  }

  /**
   * Congela nome e preço de cada item no momento da compra.
   *
   * Copiar em vez de referenciar é o que garante que alterar o preço no admin
   * não mude o valor de um pedido já feito.
   */
  private async priceItems(
    requested: readonly { productSlug: string; quantity: number }[],
    installments: number,
  ): Promise<Result<PricedItem[]>> {
    const products = await this.prisma.product.findMany({
      where: {
        slug: { in: requested.map((item) => item.productSlug) },
        published: true,
        archived: false,
      },
    });

    const bySlug = new Map(products.map((product) => [product.slug, product]));
    const priced: PricedItem[] = [];

    for (const item of requested) {
      const product = bySlug.get(item.productSlug);
      if (!product) {
        return fail(new ValidationError(`Produto "${item.productSlug}" indisponível.`));
      }
      if (item.quantity < 1 || item.quantity > 10) {
        return fail(new ValidationError('Quantidade inválida.', { field: 'quantity' }));
      }
      // O teto de parcelas é do catálogo (5× desde 26/08), não do DTO — que
      // aceita até 12 por contrato histórico. Sem esta checagem, uma chamada
      // direta à API parcelaria em 12× sem juros o que a vitrine anuncia em 5×.
      if (installments > product.maxInstallments) {
        return fail(
          new ValidationError(
            `"${product.name}" permite no máximo ${product.maxInstallments}× sem juros.`,
            { field: 'installments' },
          ),
        );
      }

      priced.push({
        productSlug: product.slug,
        productName: product.name,
        unitCents: product.promoPriceCents ?? product.priceCents,
        quantity: item.quantity,
      });
    }

    return ok(priced);
  }

  /**
   * Recota o frete no servidor em vez de aceitar o valor vindo da tela.
   *
   * Preço de frete que chega do cliente é preço que o cliente escolhe. A tela
   * mostra a cotação; o servidor refaz e usa a sua.
   */
  private async resolveShipping(
    zipCode: string,
    code: string,
  ): Promise<Result<{ code: string; priceCents: number }>> {
    const options = await this.shipping.quote({
      destinationZipCode: zipCode,
      weightGrams: KIT_WEIGHT_GRAMS,
    });

    const chosen = options.find((option) => option.code === code);
    if (!chosen) {
      return fail(new ValidationError('Modalidade de envio indisponível para este CEP.'));
    }
    return ok({ code: chosen.code, priceCents: chosen.priceCents });
  }

  /** Valida o cupom: ativo, dentro da validade e do limite de usos. */
  private async resolveCoupon(
    code: string | undefined,
  ): Promise<Result<{ code: string; discountPercent: number; commissionPercent: number } | null>> {
    if (!code) return ok(null);

    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.trim().toUpperCase() },
    });

    if (!coupon || !coupon.active) {
      return fail(new ValidationError('Cupom inválido.', { field: 'couponCode' }));
    }
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return fail(new ValidationError('Cupom expirado.', { field: 'couponCode' }));
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      return fail(new ConflictError('Cupom esgotado.', { field: 'couponCode' }));
    }

    return ok({
      code: coupon.code,
      discountPercent: Number(coupon.discountPercent),
      commissionPercent: Number(coupon.commissionPercent),
    });
  }

  /**
   * Marca como pago, registra o evento e abre o repasse do parceiro.
   *
   * O repasse nasce **junto do pagamento**, na mesma transação, e não num
   * fechamento posterior. O motivo é o que o cliente pediu ver no painel do
   * parceiro em 15/06: *"quanto vendeu, quanto converteu, previsibilidade do
   * mês"*. Previsibilidade exige que a comissão apareça no instante em que ela
   * passa a ser devida — um repasse criado só no fechamento faria o parceiro
   * olhar o painel no dia 10 e ver zero, tendo vendido.
   *
   * O `@@unique([orderId])` do `Payout` é a rede de segurança: reprocessar um
   * pagamento não paga o parceiro duas vezes.
   */
  private async markPaid(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { number: true, couponCode: true, commissionCents: true },
    });

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
  }

  /**
   * Próximo número sequencial do ano.
   *
   * Conta os pedidos do ano dentro da transação. Suficiente para o volume
   * previsto; se a concorrência crescer, vira uma tabela de sequência dedicada.
   */
  private async nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const count = await tx.order.count({
      where: { createdAt: { gte: new Date(`${year}-01-01T00:00:00Z`) } },
    });
    return formatOrderNumber(year, count + 1);
  }
}
