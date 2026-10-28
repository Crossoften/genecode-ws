import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@shared/config/env.schema';

import { LogisticsUseCase } from './use-cases/logistics.use-case';

/**
 * Sincroniza o rastreio de tempos em tempos (GC-AJ-040).
 *
 * Um `setInterval` simples, e não uma fila: a API roda em um processo só no
 * pm2, e o trabalho é uma consulta por envio andando. `SHIPPING_SYNC_MINUTES=0`
 * desliga — e nos testes ele nunca liga.
 */
@Injectable()
export class ShipmentSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Rastreio');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly logistics: LogisticsUseCase,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const minutes = this.config.get('SHIPPING_SYNC_MINUTES', { infer: true });
    if (minutes <= 0 || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), minutes * 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const moved = await this.logistics.sync();
      if (moved > 0) this.logger.log(`${moved} pedido(s) atualizados pelo rastreio.`);
    } catch (erro) {
      this.logger.error(`Sincronização falhou: ${String(erro)}`);
    } finally {
      this.running = false;
    }
  }
}
