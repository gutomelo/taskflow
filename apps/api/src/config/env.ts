import { z } from 'zod';

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const environmentSchema = z.object({
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
  };
}
