import { z } from 'zod';

/**
 * Environment contract, validated once at boot.
 *
 * The previous backend read `process.env` directly with no validation: a missing
 * `JWT_SECRET` produced tokens signed with `undefined` and the app started
 * happily. Here the process refuses to boot if anything is missing or malformed,
 * so a misconfigured deploy fails loudly instead of silently insecurely.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // Rejected below 32 chars on purpose: a short secret is a weak secret, and the
  // dev default must never survive into production unnoticed.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /** Allowed browser origin. No wildcard — the old backend shipped `origin: '*'`. */
  WEB_ORIGIN: z.string().url().default('http://localhost:4200'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // --- TLS no próprio processo -----------------------------------------------
  //
  // Não há proxy reverso na VPS de homologação: o Apache serve só o estático e
  // cada backend abre HTTPS sozinho, lendo o certificado do Let's Encrypt. É o
  // padrão de 69 dos 83 backends que rodam lá.
  //
  // Sem isto a API responderia em HTTP, e o navegador bloquearia toda chamada
  // vinda de uma página HTTPS como conteúdo misto — falha que aparece só no
  // console do navegador, nunca no log do servidor.
  ACTIVATE_SSL_CERTIFICATE: z.enum(['YES', 'NO']).default('NO'),
  SSL_KEY: z.string().optional(),
  SSL_CERT: z.string().optional(),
  SSL_CA: z.string().optional(),

  ENABLE_SWAGGER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // --- Adquirente: PagoLivre (Afinz) ----------------------------------------
  //
  // `sandbox` mantém o adapter simulado, que adianta o pedido até a fila do
  // laboratório para demonstrar o fluxo inteiro sem adquirente. `pagolivre` liga
  // a de verdade. É a única linha que separa demonstrar de cobrar.
  PAYMENT_PROVIDER: z.enum(['sandbox', 'pagolivre']).default('sandbox'),

  // O host de sandbox NÃO está na documentação da PagoLivre (ela só declara o de
  // produção). Foi descoberto e confirmado em 24/09/2026 — ver
  // docs/11-pagamento/pagolivre/README.md.
  //
  // Sem padrão de propósito: até 28/10/2026 o padrão era o sandbox, e uma
  // produção sem a variável cobraria no sandbox sem nenhum sinal. Produção:
  // https://api.pagolivre.com.br/api/v2 · sandbox: https://api.sbx.pagolivre.com.br/api/v2
  PAGOLIVRE_BASE_URL: z.string().url().optional(),
  /** Token Basic já em base64, como a PagoLivre entrega. */
  PAGOLIVRE_TOKEN: z.string().optional(),
  PAGOLIVRE_MERCHANT_ID: z.string().uuid().optional(),
  /** Para onde a PagoLivre posta os eventos. */
  PAGOLIVRE_CALLBACK_URL: z.string().url().optional(),
  /** Para onde o comprador volta depois de pagar na página da Afinz. */
  PAGOLIVRE_RETURN_URL: z.string().url().optional(),
  /**
   * Token esperado na query do webhook.
   *
   * **Opcional de propósito.** A PagoLivre não emite segredo de webhook: ela
   * devolve o próprio `PAGOLIVRE_TOKEN` na query (verificado em homologação,
   * 25/09/2026), e é com ele que o handler compara quando esta variável está
   * vazia. Ela existe para o dia em que emitirem um segredo separado.
   *
   * De todo modo não há HMAC sobre o corpo, então o handler confere o token e,
   * mesmo assim, reconsulta a ordem antes de acreditar no que chegou.
   */
  PAGOLIVRE_WEBHOOK_TOKEN: z.string().min(16).optional(),

  // --- Logística: DHL Express (GC-AJ-038 a 042) -----------------------------
  //
  // `sandbox` simula cotação, etiqueta, rastreio e coleta; `dhl` liga a MyDHL
  // API. A chave é a do portal de desenvolvedor da DHL (developer.dhl.com),
  // não o login do site MyDHL.
  SHIPPING_PROVIDER: z.enum(['sandbox', 'dhl']).default('sandbox'),
  /** `.../mydhlapi/test` em teste; `.../mydhlapi` em produção. */
  DHL_BASE_URL: z.string().url().default('https://express.api.dhl.com/mydhlapi/test'),
  DHL_API_KEY: z.string().optional(),
  DHL_API_SECRET: z.string().optional(),
  /** Conta DHL Express da Genoa, que paga a ida e a volta. */
  DHL_ACCOUNT_NUMBER: z.string().optional(),
  /** Produto doméstico: `N` = Express Domestic. */
  DHL_PRODUCT_CODE: z.string().default('N'),
  DHL_LABEL_FORMAT: z.enum(['pdf', 'zpl']).default('pdf'),
  /** A4 para imprimir em casa; `ECOM26_64_001` é o térmico 6x4 da Zebra. */
  DHL_LABEL_TEMPLATE: z.string().default('ECOM26_84_A4_001'),
  /** Minutos por etapa no rastreio simulado (sandbox e ambiente de teste da DHL). */
  SHIPPING_SIMULATION_MINUTES: z.coerce.number().int().min(1).default(5),
  /** De quanto em quanto tempo o rastreio é sincronizado; 0 desliga. */
  SHIPPING_SYNC_MINUTES: z.coerce.number().int().min(0).default(30),

  /** O laboratório: origem da ida e destino da volta. */
  SHIPPING_ORIGIN_NAME: z.string().default('Recebimento de Amostras gene.code'),
  SHIPPING_ORIGIN_COMPANY: z.string().default('Genoa Biotecnologia S.A.'),
  SHIPPING_ORIGIN_DOCUMENT: z.string().default('07671920000180'),
  SHIPPING_ORIGIN_PHONE: z.string().default('11937672072'),
  SHIPPING_ORIGIN_EMAIL: z.string().email().default('contato@genecode.com.br'),
  SHIPPING_ORIGIN_ZIP: z.string().default('01228904'),
  SHIPPING_ORIGIN_STREET: z.string().default('Avenida Angélica'),
  SHIPPING_ORIGIN_NUMBER: z.string().default('2318'),
  SHIPPING_ORIGIN_DISTRICT: z.string().default('Consolação'),
  SHIPPING_ORIGIN_CITY: z.string().default('São Paulo'),
  SHIPPING_ORIGIN_STATE: z.string().length(2).default('SP'),
  /** Envelope da volta (a caixa da ida usa o peso do produto). */
  SHIPPING_RETURN_WEIGHT_GRAMS: z.coerce.number().int().positive().default(150),

  // --- Cadastro em ambiente sem e-mail ---------------------------------------
  //
  // Homologação não tem servidor de e-mail: o código de verificação é escrito no
  // log e nunca chega a ninguém. Quem tenta criar conta fica preso — a conta
  // nasce PENDING e não autentica.
  //
  // Com `YES`, o cadastro devolve o código na resposta e a tela o exibe, para
  // que o fluxo possa ser percorrido inteiro. É uma porta de saída explícita
  // para ambiente de teste: o padrão é `NO`, e cada uso deixa aviso no log.
  //
  // ⚠️ Nunca ligar em produção. O conserto de verdade é configurar o envio de
  // e-mail; esta chave existe só enquanto ele não existe.
  MOSTRAR_CODIGO_VERIFICACAO: z.enum(['YES', 'NO']).default('NO'),

  // --- Envio de notificação transacional -------------------------------------
  //
  // `log` só escreve no log do servidor — serve para desenvolvimento e foi o que
  // deixou o cadastro impossível de concluir em homologação, porque o código de
  // verificação não chegava a ninguém. `smtp` entrega de verdade.
  CANAL_NOTIFICACAO: z.enum(['log', 'smtp']).default('log'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** Remetente, no formato que o provedor aceita como verificado. */
  SMTP_FROM: z.string().optional(),

  // --- Mídia enviada pelo admin ----------------------------------------------
  //
  // A foto do kit era uma moldura desabilitada no formulário de produto, com o
  // aviso "Envio de imagem entra com o provedor de mídia" — e os três produtos
  // em homolog ficavam com imageUrl null, mostrando a mesma caixa genérica na
  // vitrine. O provedor é o disco da própria VPS: não há CDN contratada, e um
  // punhado de fotos de kit não justifica uma.
  UPLOADS_DIR: z.string().default('./uploads'),
  /**
   * Prefixo público dos arquivos enviados, SEM barra no fim.
   *
   * Precisa ser absoluto porque a URL é gravada no banco e devolvida para a
   * vitrine, que roda em outra origem (Apache na 443, API na 3041).
   */
  UPLOADS_PUBLIC_URL: z.string().url().default('http://localhost:3000/uploads'),

  /**
   * Endereço público do front, para os links que saem por e-mail (o convite
   * de compartilhamento do GC-AJ-027). Sem barra no fim; o link usa a rota com
   * `#/`, como o resto do app.
   */
  APP_PUBLIC_URL: z.string().url().default('http://localhost:4200'),

  /**
   * Canal de privacidade que recebe os pedidos de exclusão de conta
   * (GC-AJ-006). Em produção, contato@genecode.com.br; vazio não envia nada —
   * o pedido continua registrado no banco.
   */
  PRIVACY_CONTACT_EMAIL: z.string().email().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates raw environment variables, aborting startup with a readable report
 * when the contract is not met.
 *
 * @param raw - Usually `process.env`.
 * @returns The parsed, typed and defaulted environment.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const report = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${report}`);
  }

  if (parsed.data.NODE_ENV === 'production') {
    assertProductionSecrets(parsed.data);
  }

  assertTlsIsComplete(parsed.data);
  assertAcquirerIsComplete(parsed.data);
  assertNotificationIsComplete(parsed.data);
  assertCarrierIsComplete(parsed.data);

  return parsed.data;
}

/**
 * Refuses to start with TLS half-configured.
 *
 * `ACTIVATE_SSL_CERTIFICATE=YES` without the three paths would make the process
 * fall back to plain HTTP silently, and the failure would only surface as mixed
 * content in the browser console — never in the server log. Better to refuse the
 * boot, where somebody is looking.
 */
function assertTlsIsComplete(env: Env): void {
  if (env.ACTIVATE_SSL_CERTIFICATE !== 'YES') return;

  const missing = (['SSL_KEY', 'SSL_CERT', 'SSL_CA'] as const).filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new Error(
      `ACTIVATE_SSL_CERTIFICATE=YES requires ${missing.join(', ')}. ` +
        'On the homolog VPS these point at /etc/letsencrypt/live/homolog.crosoften.com/.',
    );
  }
}

/**
 * Recusa subir com a DHL ligada e sem credencial (GC-AJ-038): a cotação do
 * checkout quebraria só na hora da compra, que é o pior momento para saber.
 */
function assertCarrierIsComplete(env: Env): void {
  if (env.SHIPPING_PROVIDER !== 'dhl') return;
  const missing = (['DHL_API_KEY', 'DHL_API_SECRET', 'DHL_ACCOUNT_NUMBER'] as const).filter(
    (name) => !env[name],
  );
  if (missing.length > 0) {
    throw new Error(`SHIPPING_PROVIDER=dhl requires ${missing.join(', ')}.`);
  }
}

/**
 * Recusa subir com o envio de e-mail pela metade.
 *
 * `CANAL_NOTIFICACAO=smtp` sem credencial produziria uma API que aceita cadastro
 * e nunca entrega o código — o mesmo sintoma que esta configuração existe para
 * resolver, só que mais difícil de perceber.
 */
function assertNotificationIsComplete(env: Env): void {
  if (env.CANAL_NOTIFICACAO !== 'smtp') return;

  const missing = (['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] as const).filter(
    (name) => !env[name],
  );

  if (missing.length > 0) {
    throw new Error(`CANAL_NOTIFICACAO=smtp requires ${missing.join(', ')}.`);
  }
}

/**
 * Refuses to start with the acquirer half-configured.
 *
 * `PAYMENT_PROVIDER=pagolivre` sem token ou sem callback subiria uma API que
 * aceita checkout e falha na hora de cobrar — o pior momento possível para
 * descobrir configuração faltando, porque já há cliente com o cartão na mão.
 */
function assertAcquirerIsComplete(env: Env): void {
  if (env.PAYMENT_PROVIDER !== 'pagolivre') return;

  const missing = (
    ['PAGOLIVRE_BASE_URL', 'PAGOLIVRE_TOKEN', 'PAGOLIVRE_CALLBACK_URL'] as const
  ).filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new Error(`PAYMENT_PROVIDER=pagolivre requires ${missing.join(', ')}.`);
  }
}

/**
 * Guards against shipping development placeholders to production.
 *
 * The compose file seeds usable dev secrets so `docker compose up` just works.
 * That convenience becomes a vulnerability the moment it reaches a real
 * environment, so production refuses to boot with them.
 */
function assertProductionSecrets(env: Env): void {
  const offenders = (
    [
      ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
    ] as const
  ).filter(([, value]) => value.startsWith('dev_'));

  if (offenders.length > 0) {
    throw new Error(
      `Refusing to start in production with development secrets: ${offenders
        .map(([name]) => name)
        .join(', ')}`,
    );
  }
}
