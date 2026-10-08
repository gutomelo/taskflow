import { pino, type DestinationStream, type Logger } from 'pino';
import type { AppConfig } from '../config/env';

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
 * encerrava o processo da API. Em produção os logs são JSON puro em stdout, e
 * pino-pretty (devDependency) nunca é carregado.
 */
async function createDevelopmentStream(): Promise<DestinationStream> {
  const { default: pretty } = await import('pino-pretty');
  return pretty({ sync: true, singleLine: true, colorize: true });
}

export async function createLogger(
  config: Pick<AppConfig, 'environment' | 'logLevel'>,
): Promise<Logger> {
  const options = {
    level: config.logLevel,
    base: { service: 'taskflow-api' },
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return config.environment === 'development'
    ? pino(options, await createDevelopmentStream())
    : pino(options);
}
