import { z } from 'zod';

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const MIN_SECRET_BYTES = 32;

// Valores de exemplo do .env.example contêm este marcador e são recusados em produção.
const DEVELOPMENT_PLACEHOLDER_MARKER = 'dev-only';

const secretSchema = z
  .string()
  .refine((value) => Buffer.byteLength(value, 'utf8') >= MIN_SECRET_BYTES, {
    message: `deve ter ao menos ${MIN_SECRET_BYTES} bytes`,
  });

/** Origem pura (esquema + host + porta), sem caminho nem barra final. */
const originSchema = z
  .url({ protocol: /^https?$/ })
  .refine((value) => new URL(value).origin === value, {
    message: 'deve ser apenas a origem, ex.: https://app.exemplo.com',
  });

/** Mapa JSON `{ "kid": "segredo" }` usado para assinar e verificar access tokens. */
const accessTokenKeysSchema = z
  .string()
  .transform((value, context) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      context.addIssue({ code: 'custom', message: 'deve ser um objeto JSON { "kid": "segredo" }' });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .record(z.string().regex(/^[A-Za-z0-9._-]{1,64}$/, 'kid inválido'), secretSchema)
      .refine((keys) => Object.keys(keys).length > 0, {
        message: 'deve conter ao menos uma chave',
      }),
  );

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3333),
    LOG_LEVEL: logLevelSchema.default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).describe('URL de conexão PostgreSQL'),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }).describe('URL de conexão Redis'),
    HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
    TRUST_PROXY: z
      .union([
        z.literal('false').transform(() => false as const),
        z.coerce.number().int().min(0).max(10),
      ])
      .default(false),
    JSON_BODY_LIMIT: z
      .string()
      .regex(/^\d+(b|kb|mb)$/i)
      .default('100kb'),
    APP_ORIGIN: originSchema,
    AUTH_ACCESS_TOKEN_KEYS: accessTokenKeysSchema,
    AUTH_ACCESS_TOKEN_ACTIVE_KID: z.string().min(1),
    CSRF_SECRET: secretSchema,
    LOG_PSEUDONYMIZATION_KEY: secretSchema,
    PASSWORD_HASH_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  })
  .superRefine((variables, context) => {
    if (!(variables.AUTH_ACCESS_TOKEN_ACTIVE_KID in variables.AUTH_ACCESS_TOKEN_KEYS)) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_ACCESS_TOKEN_ACTIVE_KID'],
        message: 'deve existir em AUTH_ACCESS_TOKEN_KEYS',
      });
    }

    if (variables.NODE_ENV !== 'production') return;

    const secrets: Array<[string, string]> = [
      ['CSRF_SECRET', variables.CSRF_SECRET],
      ['LOG_PSEUDONYMIZATION_KEY', variables.LOG_PSEUDONYMIZATION_KEY],
      ...Object.values(variables.AUTH_ACCESS_TOKEN_KEYS).map((secret): [string, string] => [
        'AUTH_ACCESS_TOKEN_KEYS',
        secret,
      ]),
    ];
    for (const [name, secret] of secrets) {
      if (secret.includes(DEVELOPMENT_PLACEHOLDER_MARKER)) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: 'usa valor de exemplo de desenvolvimento; gere um segredo real',
        });
      }
    }
  });

export type AppConfig = Readonly<{
  environment: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: z.infer<typeof logLevelSchema>;
  databaseUrl: string;
  redisUrl: string;
  healthCheckTimeoutMs: number;
  trustProxy: false | number;
  jsonBodyLimit: string;
  appOrigin: string;
  accessTokenKeys: Readonly<Record<string, string>>;
  activeAccessTokenKid: string;
  csrfSecret: string;
  logPseudonymizationKey: string;
  passwordHashConcurrency: number;
}>;

export class InvalidConfigurationError extends Error {
  constructor(readonly invalidVariables: ReadonlyArray<{ name: string; message: string }>) {
    super(
      `Configuração inválida: ${invalidVariables
        .map(({ name, message }) => `${name} (${message})`)
        .join(', ')}`,
    );
    this.name = 'InvalidConfigurationError';
  }
}

/**
 * Único ponto do backend que lê `process.env`. Falha cedo com a lista de variáveis
 * inválidas — sem incluir os valores recebidos, que podem conter segredos.
 */
export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new InvalidConfigurationError(
      result.error.issues.map((issue) => ({
        name: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  const variables = result.data;
  return {
    environment: variables.NODE_ENV,
    host: variables.API_HOST,
    port: variables.API_PORT,
    logLevel: variables.LOG_LEVEL,
    databaseUrl: variables.DATABASE_URL,
    redisUrl: variables.REDIS_URL,
    healthCheckTimeoutMs: variables.HEALTH_CHECK_TIMEOUT_MS,
    trustProxy: variables.TRUST_PROXY,
    jsonBodyLimit: variables.JSON_BODY_LIMIT,
    appOrigin: variables.APP_ORIGIN,
    accessTokenKeys: variables.AUTH_ACCESS_TOKEN_KEYS,
    activeAccessTokenKid: variables.AUTH_ACCESS_TOKEN_ACTIVE_KID,
    csrfSecret: variables.CSRF_SECRET,
    logPseudonymizationKey: variables.LOG_PSEUDONYMIZATION_KEY,
    passwordHashConcurrency: variables.PASSWORD_HASH_CONCURRENCY,
  };
}
