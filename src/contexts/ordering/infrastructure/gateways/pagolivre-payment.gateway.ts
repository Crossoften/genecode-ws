import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import type { Env } from '@shared/config/env.schema';

import type {
  ChargeRequest,
  ChargeResult,
  ChargeStatus,
  PaymentGateway,
  PaymentMethod,
} from '../../domain/ports/payment-gateway.port';

/** Status de ordem da PagoLivre → status da nossa porta. */
const STATUS: Record<string, ChargeStatus> = {
  created: 'PENDING',
  paid: 'PAID',
  canceled: 'CANCELED',
  declined: 'REFUSED',
  expired: 'EXPIRED',
};

/**
 * Meio de pagamento nosso → `receivingOptionType` da PagoLivre.
 *
 * `BOLETO` mapeia para `bankSlip`, que **não está habilitado** na conta da Genoa
 * (a API devolve 403 "A opção de recebimento selecionada não existe"). Fica
 * mapeado de propósito: habilitar é negociação comercial do cliente com a Afinz,
 * e no dia em que ligarem não há código para mexer.
 */
const RECEIVING_OPTION: Record<PaymentMethod, string> = {
  CREDIT_CARD: 'creditCard',
  PIX: 'pix',
  BOLETO: 'bankSlip',
};

interface PagoLivreOrder {
  id: string;
  orderKey?: string;
  status: string;
  paymentUrl?: string;
  expirationDate?: string;
  decliningReason?: string;
  cancelingReason?: string;
}

/**
 * Adapter da PagoLivre (Afinz) — API v2.
 *
 * Documentação lida e testada contra o sandbox em 24/09/2026; a análise completa,
 * com o que a doc promete e o que a API entrega, está em
 * `docs/11-pagamento/pagolivre/README.md`.
 *
 * ### O modelo é redirect, não cobrança direta
 *
 * `POST /orders` **não cobra ninguém**: cria uma ordem e devolve um `paymentUrl`
 * para uma página hospedada da Afinz. O pagamento acontece lá, e a confirmação
 * chega por webhook. Por isso `charge()` devolve sempre `PENDING` — nunca `PAID`.
 */
@Injectable()
export class PagoLivrePaymentGateway implements PaymentGateway {
  private readonly logger = new Logger('PagoLivre');

  /**
   * Cache de unidades já validadas.
   *
   * `GET /branches/{id}` é a única forma de saber se um `merchantId` de split
   * existe — e seria absurdo pagar essa ida a cada checkout para um punhado de
   * parceiros que quase nunca muda.
   */
  private readonly knownMerchants = new Map<string, { valid: boolean; at: number }>();
  private static readonly MERCHANT_TTL_MS = 60 * 60_000;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    // Telefone é obrigatório na prática, embora a doc diga que basta CPF **ou**
    // celular. Sem ele a PagoLivre cria a ordem e devolve o link normalmente — e
    // a página de checkout dela morre em branco na etapa "Dados de contato", sem
    // erro e sem saída (verificado em 25/09/2026). O link nasce morto.
    //
    // Falhar aqui é o mal menor: melhor o checkout recusar na nossa tela, onde
    // dá para pedir o telefone, do que entregar ao comprador um link que não
    // leva a lugar nenhum.
    const mobile = onlyDigits(request.customer.phone ?? '');
    if (mobile.length < 10) {
      throw new Error(
        'Telefone do comprador é obrigatório para a PagoLivre (DDD + número). ' +
          'Sem ele a página de pagamento não abre.',
      );
    }

    // A idempotência tem que ser nossa. A doc da PagoLivre promete que repetir a
    // criação com o mesmo `orderKey` devolve a ordem já criada (e que um
    // `requestId` diferente dá erro), mas **nenhuma das duas coisas acontece**:
    // no sandbox, três chamadas com o mesmo orderKey produziram três ordens
    // pagáveis (testado em 25/09/2026). Sem esta verificação, uma retentativa de
    // rede deixaria dois links de pagamento vivos para o mesmo pedido — e o
    // cliente poderia pagar os dois.
    const existing = await this.findByOrderKey(request.orderNumber);
    if (existing?.paymentUrl && existing.status === 'created') {
      this.logger.warn(
        `Pedido ${request.orderNumber} já tinha a ordem ${existing.id} em aberto — ` +
          'reaproveitando em vez de criar outra.',
      );
      return {
        externalId: existing.id,
        status: STATUS[existing.status] ?? 'PENDING',
        redirectUrl: existing.paymentUrl,
        expiresAt: existing.expirationDate ? new Date(existing.expirationDate) : undefined,
      };
    }

    const split = await this.buildSplit(request);

    const body = {
      // Mandado mesmo sem funcionar no sandbox: é o contrato documentado, não
      // custa nada, e se ligarem a verificação do lado deles vira uma segunda
      // barreira de graça. Derivado do número do pedido para ser estável entre
      // retentativas, inclusive depois de um restart.
      requestId: deterministicUuid(request.orderNumber),
      orderKey: request.orderNumber,
      amount: request.amountCents / 100,
      orderGuests: [{ cpf: onlyDigits(request.customer.document), mobileNumber: mobile }],
      installments: request.installments,
      receivingOptionType: RECEIVING_OPTION[request.method],
      message: `Pedido ${request.orderNumber} - GeneCode`,
      callbackUrl: this.config.get('PAGOLIVRE_CALLBACK_URL', { infer: true }),
      returnUrl: this.config.get('PAGOLIVRE_RETURN_URL', { infer: true }),
      ...(split.length > 0 ? { splitOrderPayment: split } : {}),
    };

    const order = await this.call<PagoLivreOrder>('POST', '/orders', body);

    if (!order.paymentUrl) {
      // Sem URL não há como o comprador pagar. Falhar aqui é melhor do que
      // devolver um checkout mudo à vitrine.
      throw new Error('PagoLivre criou a ordem sem paymentUrl.');
    }

    this.logger.log(
      `pedido ${request.orderNumber} → ordem ${order.id} (${request.method}` +
        `${split.length > 0 ? `, split com ${split.length}` : ''})`,
    );

    return {
      externalId: order.id,
      status: STATUS[order.status] ?? 'PENDING',
      redirectUrl: order.paymentUrl,
      expiresAt: order.expirationDate ? new Date(order.expirationDate) : undefined,
    };
  }

  /**
   * Consulta pelo NOSSO número de pedido.
   *
   * Usa `byOrderKey` de propósito: é o identificador que nós controlamos, então
   * a reconciliação funciona mesmo que o `externalId` não tenha sido gravado —
   * exatamente o cenário de falha em que a reconciliação importa.
   *
   * Limites da API: no máximo 1 consulta por segundo, e a primeira só 5 segundos
   * depois da criação. Quem chamar em laço precisa respeitar isso.
   */
  async fetchStatus(orderNumber: string): Promise<ChargeResult> {
    const order = await this.findByOrderKey(orderNumber);

    if (!order) {
      // 204 sem corpo é como a PagoLivre diz "não conheço esta chave" — não é
      // erro HTTP. Tratar como recusa evita que o chamador leia campos de um
      // objeto que não existe.
      return {
        externalId: orderNumber,
        status: 'REFUSED',
        failureReason: 'Ordem não encontrada na PagoLivre.',
      };
    }

    return {
      externalId: order.id,
      status: STATUS[order.status] ?? 'PENDING',
      redirectUrl: order.paymentUrl,
      failureReason: order.decliningReason ?? order.cancelingReason,
      expiresAt: order.expirationDate ? new Date(order.expirationDate) : undefined,
    };
  }

  /**
   * Busca a ordem pela NOSSA chave, tolerando o "não existe".
   *
   * A PagoLivre responde **204 sem corpo** para chave desconhecida — sucesso
   * HTTP, não 404. Quem chamar precisa distinguir isso de uma ordem de verdade,
   * e é por isso que este helper existe em vez de cada ponto tratar na mão.
   */
  private async findByOrderKey(orderNumber: string): Promise<PagoLivreOrder | undefined> {
    const order = await this.call<PagoLivreOrder | undefined>(
      'GET',
      `/orders/byOrderKey/${encodeURIComponent(orderNumber)}`,
    );
    return order?.id ? order : undefined;
  }

  /** Cancelamento total (sem `amountCents`) ou parcial. */
  async refund(externalId: string, amountCents?: number): Promise<void> {
    await this.call('POST', `/orders/${externalId}/cancel`, {
      cancellationRequestId: deterministicUuid(`cancel:${externalId}:${amountCents ?? 'total'}`),
      reason: 'Estorno solicitado pelo GeneCode.',
      ...(amountCents !== undefined ? { amount: amountCents / 100 } : {}),
    });
    this.logger.log(`ordem ${externalId} cancelada${amountCents ? ' parcialmente' : ''}`);
  }

  /**
   * Monta e **valida** o split antes de mandar.
   *
   * A validação é nossa porque a da PagoLivre não existe: no sandbox a API
   * aceitou com HTTP 200 um `merchantId` inexistente, seis participantes e um
   * split de 150% do valor — e o split não volta em consulta nenhuma, então um
   * erro só apareceria na liquidação, com o dinheiro já no lugar errado.
   *
   * Por isso, aqui: soma conferida contra o total, e cada unidade verificada em
   * `GET /branches/{id}`, que é a única leitura de split que a API oferece.
   */
  private async buildSplit(
    request: ChargeRequest,
  ): Promise<{ merchantId: string; amountType: number; amount: number }[]> {
    const recipients = request.split ?? [];
    if (recipients.length === 0) return [];

    const total = recipients.reduce((sum, r) => sum + r.amountCents, 0);
    if (total > request.amountCents) {
      throw new Error(
        `Split de ${(total / 100).toFixed(2)} excede o total do pedido ` +
          `${(request.amountCents / 100).toFixed(2)}.`,
      );
    }
    if (recipients.some((r) => r.amountCents <= 0)) {
      throw new Error('Split com parcela zerada ou negativa.');
    }

    for (const recipient of recipients) {
      if (!(await this.merchantExists(recipient.merchantRef))) {
        throw new Error(
          `Unidade ${recipient.merchantRef} não existe na PagoLivre. ` +
            'Confira o splitMerchantId do cupom.',
        );
      }
    }

    // amountType 2 = valor em reais. Escolhido em vez de percentual porque a
    // comissão já vem calculada em centavos pelo `order-pricing`, e converter
    // para percentual reintroduziria arredondamento onde não havia.
    return recipients.map((r) => ({
      merchantId: r.merchantRef,
      amountType: 2,
      amount: r.amountCents / 100,
    }));
  }

  private async merchantExists(merchantId: string): Promise<boolean> {
    const cached = this.knownMerchants.get(merchantId);
    if (cached && Date.now() - cached.at < PagoLivrePaymentGateway.MERCHANT_TTL_MS) {
      return cached.valid;
    }

    let valid = false;
    try {
      const branch = await this.call<{ id?: string } | undefined>(
        'GET',
        `/branches/${encodeURIComponent(merchantId)}`,
      );
      // Não basta a chamada não falhar: para uma unidade inexistente a PagoLivre
      // responde **204 sem corpo**, que é sucesso HTTP. Confiar no status aqui
      // aprovaria justamente o caso que esta verificação existe para barrar.
      valid = branch?.id === merchantId;
    } catch {
      // 400 para id malformado, 5xx para indisponibilidade. Nos dois casos não dá
      // para afirmar que a unidade existe, e o split não sai.
      valid = false;
    }

    this.knownMerchants.set(merchantId, { valid, at: Date.now() });
    return valid;
  }

  private async call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const baseUrl = this.config.get('PAGOLIVRE_BASE_URL', { infer: true });
    const token = this.config.get('PAGOLIVRE_TOKEN', { infer: true });

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // Sem User-Agent o Cloudflare da PagoLivre devolve 403 em HTML — que
        // parece erro de credencial e não é. Descoberto na leitura da doc; está
        // registrado em docs/11-pagamento/pagolivre/README.md.
        'User-Agent': 'GeneCode/1.0 (+https://genecode.com.br)',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const raw = await response.text();

    if (!response.ok) {
      // O corpo de erro da PagoLivre é `{ code, message }`; quando o Cloudflare
      // barra, vem HTML. Os dois casos precisam sair legíveis no log.
      let detail = raw.slice(0, 300);
      try {
        const parsed = JSON.parse(raw) as { code?: string; message?: string };
        detail = parsed.message ?? parsed.code ?? detail;
      } catch {
        /* mantém o texto cru */
      }
      this.logger.error(`${method} ${path} → ${response.status}: ${detail}`);
      throw new Error(`PagoLivre ${response.status}: ${detail}`);
    }

    return (raw.trim() ? JSON.parse(raw) : undefined) as T;
  }
}

/**
 * UUID estável a partir de uma chave.
 *
 * A PagoLivre exige formato GUID nos campos de idempotência, mas o que a
 * idempotência precisa é ser *determinística* — o mesmo pedido tem que produzir
 * o mesmo id sempre, inclusive depois de um restart do processo. Daí derivar de
 * hash em vez de sortear.
 */
function deterministicUuid(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join(
    '-',
  );
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}
