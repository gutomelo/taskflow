import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { DependencyProbe } from '@taskflow/backend/shared/infrastructure';
import type { AppConfig } from './config/env';
import { createHealthRouter } from './health/health.router';
import { errorHandler, notFoundHandler } from './http/problem-details';
import { resolveRequestId } from './http/request-id';

export interface AppDependencies {
  readonly config: Pick<AppConfig, 'trustProxy' | 'jsonBodyLimit' | 'healthCheckTimeoutMs'>;
  readonly logger: Logger;
  readonly probes: ReadonlyArray<DependencyProbe>;
}

/**
 * Monta a aplicação HTTP sem efeitos colaterais (sem listen nem conexões),
 * permitindo testes com Supertest e dependências falsas.
 */
export function createApp({ config, logger, probes }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId: resolveRequestId,
      // Health checks são frequentes e sem valor diagnóstico quando bem-sucedidos.
      autoLogging: { ignore: (request) => request.url?.startsWith('/health/live') ?? false },
      customLogLevel: (_request, response, error) =>
        error || response.statusCode >= 500
          ? 'error'
          : response.statusCode >= 400
            ? 'warn'
            : 'info',
    }),
  );
  app.use(helmet());
  app.use(express.json({ limit: config.jsonBodyLimit }));

  app.use('/health', createHealthRouter({ probes, timeoutMs: config.healthCheckTimeoutMs }));
  // Rotas de negócio serão montadas em /api/v1 pelos módulos (spec 001 em diante).

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
