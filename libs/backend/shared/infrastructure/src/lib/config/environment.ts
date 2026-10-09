import { z } from 'zod';

/**
 * Base comum da configuração dos processos de backend (API e worker). Cada app compõe o seu
 * schema a partir de `baseEnvironmentShape` e lê `process.env` apenas no composition root.
 */
export const baseEnvironmentShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).describe('URL de conexão PostgreSQL'),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).describe('URL de conexão Redis'),
  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
};

export const portSchema = z.coerce.number().int().min(1).max(65_535);

/** Origem pura (esquema + host + porta), sem caminho nem barra final. */
export const originSchema = z
  .url({ protocol: /^https?$/ })
  .refine((value) => new URL(value).origin === value, {
    message: 'deve ser apenas a origem, ex.: https://app.exemplo.com',
  });

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
 * Valida as variáveis com o schema do app. Falha cedo com a lista de variáveis inválidas —
 * sem incluir os valores recebidos, que podem conter segredos.
 */
export function parseEnvironment<Schema extends z.ZodType>(
  schema: Schema,
  environment: NodeJS.ProcessEnv,
): z.output<Schema> {
  const result = schema.safeParse(environment);
  if (!result.success) {
    throw new InvalidConfigurationError(
      result.error.issues.map((issue) => ({ name: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}
