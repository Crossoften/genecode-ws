import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AnalyticsModule } from '@contexts/analytics/analytics.module';
import { IdentityModule } from '@contexts/identity/identity.module';
import type { Env } from '@shared/config/env.schema';

import { ShipmentSyncScheduler } from './application/shipment-sync.scheduler';
import { AccountFeedUseCase } from './application/use-cases/account-feed.use-case';
import { CheckoutUseCase } from './application/use-cases/checkout.use-case';
import { ConfirmPaymentUseCase } from './application/use-cases/confirm-payment.use-case';
import { HandlePaymentWebhookUseCase } from './application/use-cases/handle-payment-webhook.use-case';
import { LogisticsUseCase } from './application/use-cases/logistics.use-case';
import { QuoteShippingUseCase } from './application/use-cases/quote-shipping.use-case';
import { TrackOrderUseCase } from './application/use-cases/track-order.use-case';
import { PAYMENT_GATEWAY, type PaymentGateway } from './domain/ports/payment-gateway.port';
import { SHIPPING_PROVIDER, type ShippingProvider } from './domain/ports/shipping-provider.port';
import { DhlExpressShippingProvider } from './infrastructure/gateways/dhl-express.shipping.provider';
import { PagoLivrePaymentGateway } from './infrastructure/gateways/pagolivre-payment.gateway';
import { SandboxPaymentGateway } from './infrastructure/gateways/sandbox-payment.gateway';
import { FlatRateShippingProvider } from './infrastructure/gateways/flat-rate.shipping.provider';
import { ManualShippingProvider } from './infrastructure/gateways/manual-shipping.provider';
import { SandboxShippingProvider } from './infrastructure/gateways/sandbox-shipping.provider';
import { AccountFeedController } from './presentation/controllers/account-feed.controller';
import { CheckoutController } from './presentation/controllers/checkout.controller';
import {
  AdminLogisticsController,
  PatientLogisticsController,
} from './presentation/controllers/logistics.controller';
import { PaymentWebhookController } from './presentation/controllers/payment-webhook.controller';

/**
 * Contexto de comércio: carrinho, cupom, frete, checkout e pedido.
 *
 * A adquirente já está decidida — **PagoLivre (Afinz)** — e mora atrás da porta
 * `PAYMENT_GATEWAY`, escolhida por `PAYMENT_PROVIDER` em tempo de boot. O adapter
 * de sandbox continua no ar porque homologação precisa demonstrar a venda
 * inteira sem depender da adquirente e sem ninguém pagar de verdade.
 *
 * A transportadora é a **DHL Express** (26/10, GC-AJ-038), atrás da porta
 * `SHIPPING_PROVIDER` e escolhida por `SHIPPING_PROVIDER` no boot, com o mesmo
 * par sandbox/real da adquirente.
 */
@Module({
  imports: [IdentityModule, AnalyticsModule],
  controllers: [
    CheckoutController,
    AccountFeedController,
    PaymentWebhookController,
    AdminLogisticsController,
    PatientLogisticsController,
  ],
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
    LogisticsUseCase,
    ShipmentSyncScheduler,
    {
      provide: SHIPPING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ShippingProvider => {
        const get = <K extends keyof Env>(key: K) => config.get(key, { infer: true });
        const carrier = carrierFor(get);
        // Frete único (GC-N05-09): só a cotação muda; o resto fica com a
        // transportadora de baixo. `FRETE_FIXO_CENTS=0` volta à cotação por CEP.
        const flat = get('FRETE_FIXO_CENTS');
        return flat > 0
          ? new FlatRateShippingProvider(carrier, flat, get('FRETE_FIXO_PRAZO_DIAS'))
          : carrier;
      },
    },
  ],
  exports: [PAYMENT_GATEWAY, SHIPPING_PROVIDER],
})
export class OrderingModule {}

/** A transportadora de verdade (ou a falta dela), pela `SHIPPING_PROVIDER`. */
function carrierFor(get: <K extends keyof Env>(key: K) => Env[K]): ShippingProvider {
  const minutes = get('SHIPPING_SIMULATION_MINUTES');
  const provider = get('SHIPPING_PROVIDER');
  if (provider === 'manual') return new ManualShippingProvider();
  if (provider !== 'dhl') return new SandboxShippingProvider(minutes);
  return new DhlExpressShippingProvider({
    baseUrl: get('DHL_BASE_URL'),
    apiKey: get('DHL_API_KEY')!,
    apiSecret: get('DHL_API_SECRET')!,
    accountNumber: get('DHL_ACCOUNT_NUMBER')!,
    productCode: get('DHL_PRODUCT_CODE'),
    labelFormat: get('DHL_LABEL_FORMAT'),
    labelTemplate: get('DHL_LABEL_TEMPLATE'),
    simulationMinutesPerStep: minutes,
    origin: {
      name: get('SHIPPING_ORIGIN_NAME'),
      company: get('SHIPPING_ORIGIN_COMPANY'),
      phone: get('SHIPPING_ORIGIN_PHONE'),
      email: get('SHIPPING_ORIGIN_EMAIL'),
      document: get('SHIPPING_ORIGIN_DOCUMENT'),
      zipCode: get('SHIPPING_ORIGIN_ZIP'),
      street: get('SHIPPING_ORIGIN_STREET'),
      number: get('SHIPPING_ORIGIN_NUMBER'),
      district: get('SHIPPING_ORIGIN_DISTRICT'),
      city: get('SHIPPING_ORIGIN_CITY'),
      state: get('SHIPPING_ORIGIN_STATE'),
      kind: 'business',
    },
  });
}
