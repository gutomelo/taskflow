import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { DependencyProbe } from '@taskflow/backend/shared/infrastructure';
import {
  createErrorHandler,
  httpLogSerializers,
  notFoundHandler,
  type DomainErrorMapping,
} from '@taskflow/backend/shared/http';
import type { AppConfig } from './config/env';
import { createHealthRouter } from './health/health.router';
import { resolveRequestId } from './http/request-id';

export interface AppDependencies {
  readonly config: Pick<AppConfig, 'trustProxy' | 'jsonBodyLimit' | 'healthCheckTimeoutMs'>;
  readonly logger: Logger;
  readonly probes: ReadonlyArray<DependencyProbe>;
  /** Rotas de negócio montadas em `/api/v1` (módulos dos bounded contexts). */
  readonly apiRouters?: ReadonlyArray<Router>;
  /** Mapeamentos `code → HTTP` dos erros de domínio de todos os módulos. */
  readonly domainErrors?: Readonly<Record<string, DomainErrorMapping>>;
}

/**
 * Monta a aplicação HTTP sem efeitos colaterais (sem listen nem conexões),
 * permitindo testes com Supertest e dependências falsas.
 */
export function createApp({
  config,
  logger,
  probes,
  apiRouters = [],
  domainErrors = {},
}: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId: resolveRequestId,
      serializers: httpLogSerializers,
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
  for (const router of apiRouters) {
    app.use('/api/v1', router);
  }

  app.use(notFoundHandler);
  app.use(createErrorHandler({ domainErrors }));

  return app;
}
