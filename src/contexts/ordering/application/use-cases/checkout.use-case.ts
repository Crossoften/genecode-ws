import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PaymentStatus as PaymentStatusDb, Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';

import { buildActivationCode } from '@contexts/lab/domain/activation-code';
import { PreCadastroUseCase } from '@contexts/identity/application/use-cases/pre-cadastro.use-case';
import { PrismaService } from '@infra/database/prisma.service';
import {
  ConflictError,
  UpstreamError,
  ValidationError,
} from '@shared/domain/domain-error';
import { fail, ok, type Result } from '@shared/domain/result';

import {
  ORDER_NUMBER_SPACE,
  calculateTotals,
  formatOrderNumber,
  type PricedItem,
} from '../../domain/order-pricing';
import { ConfirmPaymentUseCase } from './confirm-payment.use-case';
import {
  NIVEL_MAXIMO,
  montarPlano,
  validarCadeia,
  type FatiaDoPlano,
  type NoDaRede,
} from '@contexts/partnership/domain/rede';
import { OrderStatus } from '../../domain/order-status';
import {
  PAYMENT_GATEWAY,
  type ChargeResult,
  type ChargeStatus,
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
    /** Obrigatório: sem ele a página de pagamento da adquirente não abre. */
    readonly phone: string;
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
  };
  /** Conta logada, quando houver. O checkout também funciona anônimo. */
  readonly userId?: string;
}

export interface CheckoutOutput {
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly totalCents: number;
  readonly paymentStatus: string;
  /**
   * Para onde a vitrine deve mandar o comprador para pagar.
   *
   * Presente sempre que a cobrança ficou pendente. É a mudança que o modelo
   * hospedado impõe à tela: o checkout não termina em "pago", termina em
   * "siga para o pagamento".
   */
  readonly redirectUrl?: string;
  readonly expiresAt?: Date;
  readonly failureReason?: string;
  /** True enquanto o pagamento é simulado (sandbox) — some com a adquirente real. */
  readonly simulated: boolean;
}

/**
 * Status da cobrança (porta) → status do `Payment` (banco).
 *
 * Os dois enums não coincidem: a porta tem `CANCELED`, que o banco não tem, e o
 * banco tem `REFUNDED`, que a adquirente não distingue de cancelado. Uma cobrança
 * cancelada depois de criada é, para o nosso financeiro, dinheiro devolvido.
 */
const PAYMENT_STATUS: Record<ChargeStatus, PaymentStatusDb> = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  PAID: 'PAID',
  REFUSED: 'REFUSED',
  CANCELED: 'REFUNDED',
  EXPIRED: 'EXPIRED',
};

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
 * ### Checkout anônimo, com pré-cadastro
 *
 * `userId` é opcional porque o cliente definiu em 28/05 que a conta é oferecida
 * **depois** da confirmação do pedido. Os dados do comprador ficam congelados no
 * pedido.
 *
 * Desde 09/10 o pedido não fica órfão: quando não há conta logada, o checkout
 * cria um **pré-cadastro** com os dados que o comprador acabou de preencher e
 * vincula a compra a ele (ver `PreCadastroUseCase`). A pessoa não vê etapa
 * nenhuma a mais — recebe um e-mail convidando a criar a senha, e o histórico
 * da compra já está lá quando ela aceitar.
 */
@Injectable()
export class CheckoutUseCase {
  private readonly logger = new Logger(CheckoutUseCase.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(SHIPPING_PROVIDER) private readonly shipping: ShippingProvider,
    private readonly confirmPayment: ConfirmPaymentUseCase,
    private readonly preCadastro: PreCadastroUseCase,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: CheckoutInput): Promise<Result<CheckoutOutput>> {
    if (input.items.length === 0) {
      return fail(new ValidationError('O carrinho está vazio.'));
    }

    const items = await this.priceItems(input.items, input.payment.installments);
    if (items.isFail()) return fail(items.error);

    const shippingOption = await this.resolveShipping(
      input.address.zipCode,
      input.shippingCode,
      input.address.city,
    );
    if (shippingOption.isFail()) return fail(shippingOption.error);

    const coupon = await this.resolveCoupon(input.couponCode);
    if (coupon.isFail()) return fail(coupon.error);

    const totals = calculateTotals(items.value, shippingOption.value.priceCents, coupon.value);

    // O plano da rede é calculado antes de o pedido nascer, porque é ele que
    // dita o bolo.
    //
    // A comissão do cupom e a fatia da raiz são dois números para a mesma
    // coisa, e divergir seria a soma dos repasses não bater com o
    // `commissionCents` do pedido — o admin fecharia o mês com dois totais
    // diferentes. A cadeia é a fonte: quando ela existe, o bolo é a fatia da
    // raiz, e a comissão do pedido passa a ser a soma do plano.
    const base = totals.subtotalCents - totals.discountCents;
    const split = await this.planejarSplit(coupon.value?.code, base);
    const commissionCents =
      split.plano.length > 0
        ? split.plano.reduce((soma, fatia) => soma + fatia.amountCents, 0)
        : totals.commissionCents;

    // A conta do comprador, antes de o pedido nascer.
    //
    // Com sessão, é a dela. Sem sessão, o pré-cadastro devolve a conta
    // existente daquele e-mail/CPF ou cria uma nova e manda o convite. Nunca
    // lança: compra paga vale mais do que o vínculo, e o vínculo é refazível.
    const userId =
      input.userId ??
      (await this.preCadastro.garantirConta({
        name: input.customer.name,
        email: input.customer.email,
        document: input.customer.document,
        phone: input.customer.phone,
        addressLine: `${input.address.street}, ${input.address.number}` +
          `${input.address.complement ? ` - ${input.address.complement}` : ''}` +
          ` - ${input.address.neighborhood}, ${input.address.city}/${input.address.state}`,
        addressZip: input.address.zipCode,
      })) ??
      undefined;

    const order = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextOrderNumber(tx);

      const created = await tx.order.create({
        data: {
          number,
          userId,
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
          // A taxa segue o bolo: com cadeia, é a fatia da raiz.
          commissionRate: split.boloPercent ?? totals.commissionRate,
          commissionCents,
          ...(split.plano.length > 0
            ? { splitPlan: split.plano as unknown as Prisma.InputJsonValue }
            : {}),
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

    // A cobrança falhando não pode deixar pedido órfão.
    //
    // O pedido nasce ANTES da cobrança — precisa, porque a adquirente recebe o
    // número dele. Quando a chamada falha (a da Afinz estourou o tempo em
    // 04/10, no meio desta jornada), o pedido ficava PENDING_PAYMENT para
    // sempre, sem registro de pagamento e sem link: o comprador via um erro e
    // tinha um pedido que ninguém conseguia pagar, com o uso do cupom já
    // contado. Cancelar devolve o estado para algo verdadeiro, e o evento
    // registra o motivo para o financeiro não ficar adivinhando.
    let charge: ChargeResult;
    try {
      charge = await this.gateway.charge({
        orderNumber: order.number,
        amountCents: totals.totalCents,
        method: input.payment.method,
        installments: input.payment.installments,
        customer: input.customer,
        split: split.paraAdquirente,
      });
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'falha na adquirente';
      this.logger.error(`Pedido ${order.number}: a cobrança falhou (${motivo}). Cancelando.`);
      await this.prisma.$transaction([
        this.prisma.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.CANCELLED },
        }),
        this.prisma.orderEvent.create({
          data: {
            orderId: order.id,
            status: OrderStatus.CANCELLED,
            actor: 'system',
            note: `Cobrança não pôde ser criada: ${motivo}`.slice(0, 500),
          },
        }),
        ...(coupon.value
          ? [
              // Devolve o uso do cupom: a venda não aconteceu.
              this.prisma.coupon.update({
                where: { code: coupon.value.code },
                data: { usedCount: { decrement: 1 } },
              }),
            ]
          : []),
      ]);
      return fail(
        new UpstreamError(
          'Não foi possível iniciar o pagamento agora. Tente de novo em alguns minutos.',
          { orderNumber: order.number },
        ),
      );
    }

    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        method: input.payment.method,
        status: PAYMENT_STATUS[charge.status],
        amountCents: totals.totalCents,
        externalId: charge.externalId,
        failureReason: charge.failureReason,
        installments: input.payment.installments,
        redirectUrl: charge.redirectUrl,
        confirmedAt: charge.status === 'PAID' ? new Date() : undefined,
      },
    });

    let finalStatus = charge.status === 'PAID' ? OrderStatus.PAID : OrderStatus.PENDING_PAYMENT;
    const simulated = this.gateway.simulatesFulfillment === true;

    if (charge.status === 'PAID') {
      await this.confirmPayment.execute(order.id);

      // Enquanto a adquirente real não é ligada, o sandbox adianta o pedido até
      // a fila do laboratório para demonstrar o fluxo completo. Desaparece
      // sozinho quando o gateway real (sem a flag) assumir.
      if (simulated) {
        await this.simulateFulfillment(order.id, userId);
        finalStatus = OrderStatus.SAMPLE_RECEIVED;
      }
    }

    this.logger.log(`Pedido ${order.number}: ${charge.status}${simulated ? ' (simulado)' : ''}`);

    return ok({
      orderNumber: order.number,
      status: finalStatus,
      totalCents: totals.totalCents,
      paymentStatus: charge.status,
      redirectUrl: charge.redirectUrl,
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
    city: string,
  ): Promise<Result<{ code: string; priceCents: number }>> {
    const options = await this.shipping.quote({
      destinationZipCode: zipCode,
      destinationCity: city,
      weightGrams: KIT_WEIGHT_GRAMS,
    });

    const chosen = options.find((option) => option.code === code);
    if (!chosen) {
      return fail(new ValidationError('Modalidade de envio indisponível para este CEP.'));
    }
    return ok({ code: chosen.code, priceCents: chosen.priceCents });
  }

  /**
   * Sobe a cadeia da rede a partir do cupom que fez a venda.
   *
   * Devolve da raiz até quem vendeu, que é a ordem que `repartir` espera. O
   * teto de `NIVEL_MAXIMO` também é guarda contra ciclo: uma cadeia que se
   * mordesse o rabo rodaria para sempre aqui.
   */
  private async cadeiaDoCupom(couponCode: string): Promise<NoDaRede[]> {
    const vendedor = await this.prisma.partner.findUnique({
      where: { couponCode },
      select: { id: true, level: true, sharePercent: true, parentId: true, splitMerchantId: true },
    });
    if (!vendedor) return [];

    const cadeia: NoDaRede[] = [];
    const merchants = new Map<string, string | null>();
    let atual: typeof vendedor | null = vendedor;

    for (let passo = 0; atual && passo < NIVEL_MAXIMO; passo += 1) {
      cadeia.unshift({
        partnerId: atual.id,
        nivel: atual.level,
        fatiaPercent: Number(atual.sharePercent),
      });
      merchants.set(atual.id, atual.splitMerchantId);
      atual = atual.parentId
        ? await this.prisma.partner.findUnique({
            where: { id: atual.parentId },
            select: {
              id: true,
              level: true,
              sharePercent: true,
              parentId: true,
              splitMerchantId: true,
            },
          })
        : null;
    }

    this.merchantsDaCadeia = merchants;
    return cadeia;
  }

  /** `splitMerchantId` por parceiro da última cadeia resolvida. */
  private merchantsDaCadeia = new Map<string, string | null>();

  /**
   * Monta o plano de split da venda, da raiz até quem vendeu.
   *
   * O cupom identifica o parceiro, mas **não serve como destinatário**: a
   * adquirente exige o id de uma unidade cadastrada nela (`splitMerchantId`).
   * Quem ainda não tem fica de fora da lista mandada à adquirente — a fatia
   * dele permanece com a Genoa e o repasse vira trabalho manual do financeiro.
   * Bloquear a compra porque falta cadastro do parceiro seria punir o cliente
   * por uma pendência que não é dele.
   *
   * O plano inteiro é devolvido, inclusive as fatias que não entraram no split:
   * é dele que nascem os `Payout`, e é ele que fica gravado no pedido — a
   * adquirente não devolve o split em consulta nenhuma.
   */
  private async planejarSplit(
    couponCode: string | undefined,
    baseCents: number,
  ): Promise<{
    plano: FatiaDoPlano[];
    paraAdquirente: { merchantRef: string; amountCents: number }[] | undefined;
    /** Fatia da raiz — o bolo da rede nesta venda. */
    boloPercent: number | null;
  }> {
    if (!couponCode || baseCents <= 0) {
      return { plano: [], paraAdquirente: undefined, boloPercent: null };
    }

    const cadeia = await this.cadeiaDoCupom(couponCode);
    if (cadeia.length === 0) return { plano: [], paraAdquirente: undefined, boloPercent: null };

    const coerente = validarCadeia(cadeia);
    if (coerente.isFail()) {
      // Cadeia incoerente não produz erro de split — produz split errado, com
      // dinheiro no lugar errado. A venda segue sem split e o financeiro
      // resolve na mão, com o alarme no log.
      this.logger.error(
        `Cupom ${couponCode}: cadeia da rede incoerente (${coerente.error.message}). ` +
          'Venda sem split; repasse manual.',
      );
      return { plano: [], paraAdquirente: undefined, boloPercent: null };
    }

    // A base é o valor dos produtos já com o desconto — a mesma de que o
    // `order-pricing` tira a comissão. Cada percentual do plano é, portanto,
    // percentual DO PEDIDO, e a soma das fatias é a fatia da raiz: o bolo.
    const { plano, paraAdquirente } = montarPlano(cadeia, this.merchantsDaCadeia, baseCents);

    const semCadastro = plano.filter((fatia) => !fatia.viaSplit);
    if (semCadastro.length > 0) {
      this.logger.warn(
        `Cupom ${couponCode}: ${semCadastro.length} de ${plano.length} parceiros da cadeia ` +
          'sem splitMerchantId — a fatia deles fica com a Genoa e o repasse será manual.',
      );
    }

    return {
      plano: [...plano],
      paraAdquirente: paraAdquirente.length > 0 ? [...paraAdquirente] : undefined,
      boloPercent: cadeia[0].fatiaPercent,
    };
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
   * Número do pedido: ano + sufixo **aleatório** de cinco dígitos.
   *
   * Era sequencial — o primeiro pedido do ano saía `GC-2026-00001`, o
   * trigésimo `GC-2026-00030`. O Camara viu isso no painel do parceiro em
   * 09/10 e disse o que o número entregava: *"aí o cara chega e fala: p***,
   * os caras fizeram 31, como tá escrito aí, ó, 28, 29"* — pediu *"um
   * negócio meio mais aleatório"*, *"para ninguém saber o que que a gente
   * fez"*.
   *
   * Não é vaidade: o número do pedido aparece para **todo parceiro da rede**
   * no painel de vendas dele. Sequencial, ele é um contador público do volume
   * da Genoa, e dois pedidos do mesmo parceiro em semanas diferentes revelam
   * quantas vendas a casa inteira fez no intervalo.
   *
   * Sorteia e confere a colisão. Em cinco dígitos por ano o espaço é pequeno
   * o bastante para colidir de verdade (aniversário bate perto dos 400
   * pedidos), por isso o laço, e grande o bastante para o laço nunca ficar
   * caro no volume previsto. Se um dia o ano passar de alguns milhares de
   * pedidos, o sufixo ganha um dígito — e não volta a ser sequencial.
   *
   * `randomInt` do `crypto`, e não `Math.random`, pelo mesmo motivo do código
   * do kit: número de pedido adivinhável é pedido rastreável por quem não é
   * dono dele — a tela pública de acompanhamento abre pelo número.
   */
  private async nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    for (;;) {
      const number = formatOrderNumber(year, randomInt(ORDER_NUMBER_SPACE));
      const existe = await tx.order.findUnique({ where: { number }, select: { id: true } });
      if (!existe) return number;
    }
  }
}
