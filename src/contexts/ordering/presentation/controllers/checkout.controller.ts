import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { IsPublic } from '@contexts/identity/presentation/decorators';

import { CheckoutUseCase } from '../../application/use-cases/checkout.use-case';
import { TrackOrderUseCase } from '../../application/use-cases/track-order.use-case';
import { QuoteShippingUseCase } from '../../application/use-cases/quote-shipping.use-case';
import { CheckoutDto } from '../dtos/checkout.dto';

@ApiTags('Checkout')
@Controller()
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutUseCase,
    private readonly quoteShipping: QuoteShippingUseCase,
    private readonly trackOrder: TrackOrderUseCase,
  ) {}

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
  async create(@Body() dto: CheckoutDto) {
    const result = await this.checkout.execute({
      customer: dto.customer,
      address: dto.address,
      items: dto.items,
      shippingCode: dto.shippingCode,
      couponCode: dto.couponCode,
      payment: dto.payment,
    });
    if (result.isFail()) throw result.error;
    return result.value;
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
