import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IdentityModule } from '@contexts/identity/identity.module';
import type { Env } from '@shared/config/env.schema';

import { AccountFeedUseCase } from './application/use-cases/account-feed.use-case';
import { CheckoutUseCase } from './application/use-cases/checkout.use-case';
import { ConfirmPaymentUseCase } from './application/use-cases/confirm-payment.use-case';
import { HandlePaymentWebhookUseCase } from './application/use-cases/handle-payment-webhook.use-case';
import { QuoteShippingUseCase } from './application/use-cases/quote-shipping.use-case';
import { TrackOrderUseCase } from './application/use-cases/track-order.use-case';
import { PAYMENT_GATEWAY, type PaymentGateway } from './domain/ports/payment-gateway.port';
import { SHIPPING_PROVIDER } from './domain/ports/shipping-provider.port';
import { PagoLivrePaymentGateway } from './infrastructure/gateways/pagolivre-payment.gateway';
import { SandboxPaymentGateway } from './infrastructure/gateways/sandbox-payment.gateway';
import { SandboxShippingProvider } from './infrastructure/gateways/sandbox-shipping.provider';
import { AccountFeedController } from './presentation/controllers/account-feed.controller';
import { CheckoutController } from './presentation/controllers/checkout.controller';
import { PaymentWebhookController } from './presentation/controllers/payment-webhook.controller';

/**
 * Contexto de comércio: carrinho, cupom, frete, checkout e pedido.
 *
 * A adquirente já está decidida — **PagoLivre (Afinz)** — e mora atrás da porta
 * `PAYMENT_GATEWAY`, escolhida por `PAYMENT_PROVIDER` em tempo de boot. O adapter
 * de sandbox continua no ar porque homologação precisa demonstrar a venda
 * inteira sem depender da adquirente e sem ninguém pagar de verdade.
 *
 * A transportadora continua indefinida, ainda apontando para o adapter simulado.
 */
@Module({
  imports: [IdentityModule],
  controllers: [CheckoutController, AccountFeedController, PaymentWebhookController],
  providers: [
    AccountFeedUseCase,
    CheckoutUseCase,
    ConfirmPaymentUseCase,
    HandlePaymentWebhookUseCase,
    QuoteShippingUseCase,
    TrackOrderUseCase,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PaymentGateway =>
        config.get('PAYMENT_PROVIDER', { infer: true }) === 'pagolivre'
          ? new PagoLivrePaymentGateway(config)
          : new SandboxPaymentGateway(),
    },
    { provide: SHIPPING_PROVIDER, useClass: SandboxShippingProvider },
  ],
  exports: [PAYMENT_GATEWAY, SHIPPING_PROVIDER],
})
export class OrderingModule {}
