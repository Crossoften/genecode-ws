import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';

import { IsPublic } from '@contexts/identity/presentation/decorators';
import type { Env } from '@shared/config/env.schema';

import {
  HandlePaymentWebhookUseCase,
  type PaymentWebhookEvent,
} from '../../application/use-cases/handle-payment-webhook.use-case';

/**
 * Recebedor das notificações da PagoLivre.
 *
 * Fora do Swagger de propósito: não é API de cliente, é ponta de integração, e
 * publicá-la só ensinaria a forjar evento.
 */
@ApiExcludeController()
@Controller('webhooks')
export class PaymentWebhookController {
  private readonly logger = new Logger('PagoLivreWebhook');

  constructor(
    private readonly handle: HandlePaymentWebhookUseCase,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Um endpoint para os cinco eventos.
   *
   * A PagoLivre posta todos na mesma URL cadastrada, então o roteamento por tipo
   * é do caso de uso — que, de todo modo, reconsulta a ordem em vez de confiar
   * no que chegou.
   *
   * **Sempre responde 200** quando o token confere, mesmo com evento
   * desconhecido ou pedido inexistente. Um erro aqui faz a PagoLivre repetir dez
   * vezes a cada 5 minutos, e nenhuma das repetições resolveria um pedido que
   * não existe. O que precisa de atenção vai para o log.
   */
  @Post('pagolivre')
  @IsPublic()
  @HttpCode(HttpStatus.OK)
  async pagolivre(
    @Query('accessToken') accessToken: string | undefined,
    @Body() event: PaymentWebhookEvent,
  ): Promise<{ received: true }> {
    this.assertToken(accessToken);

    try {
      await this.handle.execute(event ?? {});
    } catch (error) {
      // Engolir e registrar: a retentativa da PagoLivre não conserta erro nosso,
      // e a reconciliação por consulta cobre o que se perder aqui.
      this.logger.error(
        `Falha ao processar ${event?.eventName ?? '?'} do pedido ${event?.orderKey ?? '?'}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return { received: true };
  }

  /**
   * Confere o token da query.
   *
   * É a única autenticação que a PagoLivre oferece no callback — não existe HMAC
   * sobre o corpo. Comparação em tempo constante porque a alternativa vaza o
   * token caractere a caractere para quem medir a resposta.
   *
   * ### O que a PagoLivre manda de verdade
   *
   * Não é um segredo de webhook próprio: ela **devolve o nosso próprio token
   * Basic da API** na query (verificado em homologação, 25/09/2026). Por isso o
   * padrão é comparar com `PAGOLIVRE_TOKEN`. `PAGOLIVRE_WEBHOOK_TOKEN` fica
   * disponível para o dia em que eles emitirem um segredo separado — que é o que
   * deveria ser.
   *
   * ⚠️ Consequência: cada callback carrega a credencial de API inteira numa URL.
   * Esta API termina o TLS no próprio processo, sem proxy reverso, então a URL
   * não cai em log de intermediário. Se um dia entrar proxy, CDN ou coletor de
   * erro na frente, isso vira vazamento de credencial.
   */
  private assertToken(received: string | undefined): void {
    const expected =
      this.config.get('PAGOLIVRE_WEBHOOK_TOKEN', { infer: true }) ??
      this.config.get('PAGOLIVRE_TOKEN', { infer: true });

    if (!expected) {
      // Sem token configurado o endpoint fica fechado, não aberto. Um webhook
      // que aceita qualquer chamada é um endpoint que marca pedido como pago
      // para quem pedir.
      throw new UnauthorizedException();
    }

    const a = Buffer.from(received ?? '');
    const b = Buffer.from(expected);

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      // O que chegou vai para o log em forma de impressão digital — comprimento
      // e os quatro primeiros caracteres. É o suficiente para distinguir "a
      // PagoLivre mandou outro token" de "não mandou nenhum", que são problemas
      // diferentes, sem escrever credencial inteira em log.
      this.logger.warn(
        `Webhook recusado: token inválido (recebido: ${
          received === undefined ? 'AUSENTE' : `${received.length} chars, começa com "${received.slice(0, 4)}"`
        }; esperado: ${expected.length} chars).`,
      );
      throw new UnauthorizedException();
    }
  }
}
