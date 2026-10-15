import { z } from 'zod';
import {
  baseEnvironmentShape,
  originSchema,
  parseEnvironment,
  portSchema,
  type LogLevel,
} from '@taskflow/backend/shared/infrastructure';

/** `Nome <endereco@dominio>` ou só o endereço; sem quebras de linha (injeção de cabeçalho). */
const emailFromSchema = z
  .string()
  .regex(
    /^(?:[^<>\r\n]*<[^<>\s@]+@[^<>\s@]+>|[^<>\s@]+@[^<>\s@]+)$/,
    'deve ser "Nome <endereco@dominio>" ou um endereço de e-mail',
  );

const environmentSchema = z
  .object({
    ...baseEnvironmentShape,
    WORKER_HOST: z.string().min(1).default('0.0.0.0'),
    WORKER_PORT: portSchema.default(3334),
    // Base dos links enviados por e-mail (verificação, redefinição de senha).
    APP_URL: originSchema,
    SMTP_URL: z.url({ protocol: /^smtps?$/ }),
    EMAIL_FROM: emailFromSchema,
  })
  .superRefine((variables, context) => {
    // Links de e-mail carregam tokens de uso único: em produção, somente HTTPS.
    if (variables.NODE_ENV === 'production' && !variables.APP_URL.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'deve usar https em produção',
      });
    }
  });

export type WorkerConfig = Readonly<{
  environment: 'development' | 'test' | 'production';
  logLevel: LogLevel;
  databaseUrl: string;
  redisUrl: string;
  healthCheckTimeoutMs: number;
  host: string;
  port: number;
  appUrl: string;
  smtpUrl: string;
  emailFrom: string;
}>;

/** Configuração do worker; `main.ts` é o único ponto que lê `process.env` e a repassa aqui. */
export function loadWorkerConfig(environment: NodeJS.ProcessEnv): WorkerConfig {
  const variables = parseEnvironment(environmentSchema, environment);
  return {
    environment: variables.NODE_ENV,
    logLevel: variables.LOG_LEVEL,
    databaseUrl: variables.DATABASE_URL,
    redisUrl: variables.REDIS_URL,
    healthCheckTimeoutMs: variables.HEALTH_CHECK_TIMEOUT_MS,
    host: variables.WORKER_HOST,
    port: variables.WORKER_PORT,
    appUrl: variables.APP_URL,
    smtpUrl: variables.SMTP_URL,
    emailFrom: variables.EMAIL_FROM,
  };
}
