import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { IsPublic } from '@contexts/identity/presentation/decorators';
import type { Env } from '@shared/config/env.schema';

import { CheckoutUseCase } from '../../application/use-cases/checkout.use-case';
import { TrackOrderUseCase } from '../../application/use-cases/track-order.use-case';
import { QuoteShippingUseCase } from '../../application/use-cases/quote-shipping.use-case';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../../domain/ports/payment-gateway.port';
import { CheckoutDto } from '../dtos/checkout.dto';

@ApiTags('Checkout')
@Controller()
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutUseCase,
    private readonly quoteShipping: QuoteShippingUseCase,
    private readonly trackOrder: TrackOrderUseCase,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  /** Diz à vitrine se o pagamento está simulado, para o checkout se rotular. */
  @Get('checkout/config')
  @IsPublic()
  @ApiOperation({ summary: 'Configuração pública do checkout' })
  checkoutConfig() {
    return { paymentSimulated: this.gateway.simulatesFulfillment === true };
  }

  /** Cotação de frete para um CEP. Pública: acontece antes de haver conta. */
  @Get('frete/cotacao')
  @IsPublic()
  @ApiOperation({ summary: 'Cota o frete para um CEP' })
  async quote(@Query('cep') cep: string) {
    const result = await this.quoteShipping.execute(cep ?? '');
    if (result.isFail()) throw result.error;
    return { options: result.value };
  }

  /**
   * Fecha o pedido.
   *
   * Pública porque o cliente definiu em 28/05 que a conta é oferecida **depois**
   * da confirmação. Rate limit apertado: é o endpoint que cria registro e chama
   * a adquirente.
   */
  @Post('checkout')
  @IsPublic()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Finaliza a compra' })
  async create(@Body() dto: CheckoutDto, @Req() request: Request) {
    const result = await this.checkout.execute({
      customer: dto.customer,
      address: dto.address,
      items: dto.items,
      shippingCode: dto.shippingCode,
      couponCode: dto.couponCode,
      payment: dto.payment,
      // Guest checkout continua público (a conta é oferecida depois, 28/05),
      // mas quem JÁ está logado tem o pedido vinculado à conta — senão a própria
      // compradora não veria a compra na área dela. Token opcional: sem sessão,
      // segue anônimo.
      userId: await this.optionalUserId(request),
    });
    if (result.isFail()) throw result.error;
    return result.value;
  }

  /** Decodifica o Bearer se houver — sem token, checkout anônimo, sem erro. */
  private async optionalUserId(request: Request): Promise<string | undefined> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return undefined;
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string }>(header.slice(7), {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
      return claims.sub;
    } catch {
      return undefined;
    }
  }

  /**
   * Acompanhamento do pedido.
   *
   * Pública por número do pedido: quem comprou sem conta precisa acompanhar, e
   * o número é longo o bastante para não ser adivinhado. Não devolve nenhum dado
   * pessoal além do primeiro nome — só a linha do tempo.
   */
  @Get('pedidos/:number/acompanhamento')
  @IsPublic()
  @ApiOperation({ summary: 'Linha do tempo do pedido' })
  async track(@Param('number') number: string) {
    const result = await this.trackOrder.execute(number);
    if (result.isFail()) throw result.error;
    return result.value;
  }
}
