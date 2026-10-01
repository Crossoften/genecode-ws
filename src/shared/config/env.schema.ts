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

  // --- Texto de recomendação do laudo (decisão L4) --------------------------
  //
  // O padrão é `table`: determinístico, auditável e sem custo por laudo. A IA
  // entra por configuração, e alternar entre as duas é mudar esta variável —
  // que é o que "agnóstica de modelo, trocável sem reescrita" significa na
  // prática.
  AI_NARRATIVE_PROVIDER: z.enum(['table', 'ai']).default('table'),
  AI_NARRATIVE_URL: z.string().url().default('https://api.anthropic.com/v1/messages'),
  AI_NARRATIVE_MODEL: z.string().default('claude-sonnet-5'),
  AI_NARRATIVE_API_KEY: z.string().optional(),

  // --- Adquirente: PagoLivre (Afinz) ----------------------------------------
  //
  // `sandbox` mantém o adapter simulado, que adianta o pedido até a fila do
  // laboratório para demonstrar o fluxo inteiro sem adquirente. `pagolivre` liga
  // a de verdade. É a única linha que separa demonstrar de cobrar.
  PAYMENT_PROVIDER: z.enum(['sandbox', 'pagolivre']).default('sandbox'),

  // O host de sandbox NÃO está na documentação da PagoLivre (ela só declara o de
  // produção). Foi descoberto e confirmado em 24/09/2026 — ver
  // docs/11-pagamento/pagolivre/README.md.
  PAGOLIVRE_BASE_URL: z.string().url().default('https://api.sbx.pagolivre.com.br/api/v2'),
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

  const missing = (['PAGOLIVRE_TOKEN', 'PAGOLIVRE_CALLBACK_URL'] as const).filter(
    (name) => !env[name],
  );

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
