import { pino, type DestinationStream, type Level, type Logger } from 'pino';

export type LogLevel = Level | 'silent';

export interface LoggerOptions {
  /** Identifica o processo nos logs agregados (ex.: `taskflow-api`, `taskflow-worker`). */
  readonly service: string;
  readonly environment: 'development' | 'test' | 'production';
  readonly level: LogLevel;
}

// Caminhos que nunca podem aparecer em logs (credenciais e tokens).
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

/**
 * Em desenvolvimento, formata os logs com pino-pretty como stream síncrono.
 * Não usamos `transport` (worker thread): sob o executor @nx/js:node o worker
 * encerrava o processo. Em produção os logs são JSON puro em stdout, e
 * pino-pretty (devDependency) nunca é carregado.
 */
async function createDevelopmentStream(): Promise<DestinationStream> {
  const { default: pretty } = await import('pino-pretty');
  return pretty({ sync: true, singleLine: true, colorize: true });
}

export async function createLogger({
  service,
  environment,
  level,
}: LoggerOptions): Promise<Logger> {
  const options = {
    level,
    base: { service },
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return environment === 'development'
    ? pino(options, await createDevelopmentStream())
    : pino(options);
}
