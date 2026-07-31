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

  ENABLE_SWAGGER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
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

  return parsed.data;
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
