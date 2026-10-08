import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';

import type { Env } from '@shared/config/env.schema';

import { AppModule } from './app.module';
import { validateEnv } from '@shared/config/env.schema';

/**
 * Reads the Let's Encrypt certificate when TLS is enabled for this process.
 *
 * The homolog VPS has no reverse proxy: Apache serves static files only, and
 * each backend terminates TLS itself. Returns `undefined` in development, where
 * the container speaks plain HTTP behind the dev-server proxy.
 */
function httpsOptions(): { key: Buffer; cert: Buffer; ca: Buffer } | undefined {
  const env = validateEnv(process.env);
  if (env.ACTIVATE_SSL_CERTIFICATE !== 'YES') return undefined;

  return {
    key: readFileSync(env.SSL_KEY!),
    cert: readFileSync(env.SSL_CERT!),
    ca: readFileSync(env.SSL_CA!),
  };
}

async function bootstrap(): Promise<void> {
  const https = httpsOptions();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    https ? { httpsOptions: https } : {},
  );
  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('Bootstrap');

  // Applied unconditionally. The previous backend only enabled helmet inside the
  // SSL branch, so every HTTP deployment ran without security headers.
  app.use(helmet());
  app.use(compression());

  // Explicit origin, never '*'. Credentials are required for the refresh flow.
  app.enableCors({
    origin: config.get('WEB_ORIGIN', { infer: true }),
    credentials: true,
  });

  app.setGlobalPrefix('v1');

  // Fotos enviadas pelo admin, servidas pelo próprio processo.
  //
  // Fora do prefixo /v1 de propósito: a URL vai gravada no banco e aparece na
  // vitrine, onde versionar com a API não faz sentido — a foto não muda de
  // formato quando o contrato da API muda. `index: false` para o diretório
  // nunca listar seu conteúdo.
  const uploads = resolve(config.get('UPLOADS_DIR', { infer: true }));
  mkdirSync(uploads, { recursive: true });
  app.useStaticAssets(uploads, {
    prefix: '/uploads/',
    index: false,
    setHeaders: (res) => {
      // O helmet põe `Cross-Origin-Resource-Policy: same-origin` em tudo, e a
      // foto do kit É servida para outra origem: a vitrine mora na 443 do
      // Apache e a API na 3041. Com same-origin o fetch devolve 200 e o <img>
      // fica com naturalWidth 0 — carrega e não desenha, sem erro na tela.
      //
      // `cross-origin` vale só para este diretório, que tem imagem pública e
      // mais nada; as rotas da API seguem com o padrão do helmet.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strips properties with no decorator, and rejects requests that carry
      // them. Without this the API is open to mass assignment — the old one ran
      // `new ValidationPipe()` with no options, so a body could smuggle
      // `role: "Master"` straight into a Prisma write.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (config.get('ENABLE_SWAGGER', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('GeneCode API')
        .setDescription('API da plataforma de testes genéticos GeneCode')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
    logger.log('Swagger disponível em /docs');
  }

  // Without an explicit host the server binds to localhost inside the container
  // and the published port never answers.
  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  logger.log(`API no ar em ${https ? 'https' : 'http'}://0.0.0.0:${port}/v1`);
  logger.log(`API ouvindo na porta ${port} (${config.get('NODE_ENV', { infer: true })})`);
}

void bootstrap();
