import { Module } from '@nestjs/common';

import { IdentityModule } from '@contexts/identity/identity.module';

import { CheckoutUseCase } from './application/use-cases/checkout.use-case';
import { QuoteShippingUseCase } from './application/use-cases/quote-shipping.use-case';
import { TrackOrderUseCase } from './application/use-cases/track-order.use-case';
import { PAYMENT_GATEWAY } from './domain/ports/payment-gateway.port';
import { SHIPPING_PROVIDER } from './domain/ports/shipping-provider.port';
import { SandboxPaymentGateway } from './infrastructure/gateways/sandbox-payment.gateway';
import { SandboxShippingProvider } from './infrastructure/gateways/sandbox-shipping.provider';
import { CheckoutController } from './presentation/controllers/checkout.controller';

/**
 * Contexto de comércio: carrinho, cupom, frete, checkout e pedido.
 *
 * As duas ligações abaixo são as que o cliente ainda não decidiu — adquirente e
 * transportadora. Estão apontando para adapters de sandbox; trocar por Pagar.me
 * e Melhor Envio é substituir a classe nestas duas linhas, sem tocar em caso de
 * uso, controller ou tela.
 */
@Module({
  imports: [IdentityModule],
  controllers: [CheckoutController],
  providers: [
    CheckoutUseCase,
    QuoteShippingUseCase,
    TrackOrderUseCase,
    { provide: PAYMENT_GATEWAY, useClass: SandboxPaymentGateway },
    { provide: SHIPPING_PROVIDER, useClass: SandboxShippingProvider },
  ],
  exports: [PAYMENT_GATEWAY, SHIPPING_PROVIDER],
})
export class OrderingModule {}
