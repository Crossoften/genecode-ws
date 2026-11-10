import { Controller, HttpCode, Post, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { TRUST_PROXY } from './trust-proxy';

/** Mesmo limite do POST /auth/login. */
@Controller()
class LoginFalsoController {
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  entrar() {
    return { ok: true };
  }
}

async function subir(trustProxy: string | false): Promise<INestApplication> {
  const modulo = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }])],
    controllers: [LoginFalsoController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();
  const app = modulo.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', trustProxy);
  await app.init();
  return app;
}

/** Cinco pessoas diferentes entrando pelo proxy, cada uma uma vez. */
async function cincoPessoas(app: INestApplication): Promise<void> {
  for (let i = 1; i <= 5; i++) {
    await request(app.getHttpServer()).post('/login').set('X-Forwarded-For', `200.0.0.${i}`).expect(200);
  }
}

/**
 * Card #749, PDF 05: atrás do Apache, toda requisição vem de 127.0.0.1. O
 * supertest também conecta pelo loopback, então reproduz o proxy da produção.
 */
describe('limite do login atrás do proxy', () => {
  it('sem confiar no proxy, a sexta PESSOA diferente toma 429 (o defeito)', async () => {
    const app = await subir(false);
    await cincoPessoas(app);
    await request(app.getHttpServer()).post('/login').set('X-Forwarded-For', '200.0.0.6').expect(429);
    await app.close();
  });

  it('confiando no proxy local, cada pessoa tem o próprio limite', async () => {
    const app = await subir(TRUST_PROXY);
    await cincoPessoas(app);
    await request(app.getHttpServer()).post('/login').set('X-Forwarded-For', '200.0.0.6').expect(200);
    await app.close();
  });

  it('e a mesma pessoa continua barrada na sexta tentativa do minuto', async () => {
    const app = await subir(TRUST_PROXY);
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/login').set('X-Forwarded-For', '200.0.0.9').expect(200);
    }
    await request(app.getHttpServer()).post('/login').set('X-Forwarded-For', '200.0.0.9').expect(429);
    await app.close();
  });
});
