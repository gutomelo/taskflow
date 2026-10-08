import { Router } from 'express';
import type { LivenessReport } from '@taskflow/contracts';
import type { DependencyProbe } from '@taskflow/backend/shared/infrastructure';
import { checkReadiness } from './check-readiness';

export interface HealthRouterDependencies {
  readonly probes: ReadonlyArray<DependencyProbe>;
  readonly timeoutMs: number;
}

export function createHealthRouter({ probes, timeoutMs }: HealthRouterDependencies): Router {
  const router = Router();

  router.get('/live', (_request, response) => {
    const report: LivenessReport = { status: 'ok' };
    response.json(report);
  });

  router.get('/ready', async (request, response) => {
    const { report, failures } = await checkReadiness(probes, timeoutMs);

    for (const { name, error } of failures) {
      request.log.warn({ dependency: name, err: error }, 'Dependency check failed');
    }

    response
      .status(report.status === 'ready' ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json(report);
  });

  return router;
}
