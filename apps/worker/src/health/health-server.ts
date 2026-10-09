import { createServer, type Server, type ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import type { LivenessReport, ReadinessReport } from '@taskflow/contracts';
import { checkReadiness, type DependencyProbe } from '@taskflow/backend/shared/infrastructure';

export interface HealthServerDependencies {
  readonly probes: ReadonlyArray<DependencyProbe>;
  readonly timeoutMs: number;
  readonly logger: Logger;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

/**
 * Health do worker (`/health/live`, `/health/ready`) com os mesmos contratos da API.
 * O worker não serve API, então um `node:http` mínimo basta — sem Express nem middlewares.
 */
export function createHealthServer({
  probes,
  timeoutMs,
  logger,
}: HealthServerDependencies): Server {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://worker').pathname;

    if (path !== '/health/live' && path !== '/health/ready') {
      sendJson(response, 404, { status: 404, title: 'Not Found' });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendJson(response, 405, { status: 405, title: 'Method Not Allowed' });
      return;
    }

    if (path === '/health/live') {
      sendJson(response, 200, { status: 'ok' } satisfies LivenessReport);
      return;
    }

    checkReadiness(probes, timeoutMs)
      .then(({ report, failures }) => {
        for (const { name, error } of failures) {
          logger.warn({ dependency: name, err: error }, 'Dependency check failed');
        }
        sendJson(response, report.status === 'ready' ? 200 : 503, report satisfies ReadinessReport);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Readiness check crashed');
        sendJson(response, 500, { status: 500, title: 'Internal Server Error' });
      });
  });

  // Probes têm timeout próprio; requisições lentas de clientes não seguram o processo.
  server.requestTimeout = timeoutMs + 5_000;
  return server;
}
