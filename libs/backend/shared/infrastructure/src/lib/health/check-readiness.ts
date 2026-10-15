import type { DependencyProbe } from './dependency-probe';

// Tipos estruturalmente idênticos a `ReadinessReport` de `@taskflow/contracts`: a infraestrutura
// não depende de contratos HTTP; cada app tipa a resposta com o contrato ao serializar.
export interface DependencyCheck {
  readonly name: string;
  readonly status: 'up' | 'down';
  readonly latencyMs: number;
}

export interface ReadinessReport {
  readonly status: 'ready' | 'not_ready';
  readonly checks: DependencyCheck[];
}

export interface ReadinessResult {
  readonly report: ReadinessReport;
  /** Falhas por dependência, apenas para log — nunca enviadas ao cliente. */
  readonly failures: ReadonlyArray<{ name: string; error: unknown }>;
}

class ProbeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Probe timed out after ${timeoutMs}ms`);
    this.name = 'ProbeTimeoutError';
  }
}

async function runWithTimeout(probe: DependencyProbe, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new ProbeTimeoutError(timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    // A corrida garante o timeout mesmo para probes que ignoram o signal.
    await Promise.race([probe.check(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkReadiness(
  probes: ReadonlyArray<DependencyProbe>,
  timeoutMs: number,
  now: () => number = () => performance.now(),
): Promise<ReadinessResult> {
  const outcomes = await Promise.all(
    probes.map(async (probe) => {
      const startedAt = now();
      const elapsed = () => Math.max(0, Math.round(now() - startedAt));
      try {
        await runWithTimeout(probe, timeoutMs);
        return { name: probe.name, status: 'up' as const, latencyMs: elapsed(), error: undefined };
      } catch (error) {
        return { name: probe.name, status: 'down' as const, latencyMs: elapsed(), error };
      }
    }),
  );

  const checks: DependencyCheck[] = outcomes.map(({ name, status, latencyMs }) => ({
    name,
    status,
    latencyMs,
  }));

  return {
    report: {
      status: checks.every((check) => check.status === 'up') ? 'ready' : 'not_ready',
      checks,
    },
    failures: outcomes
      .filter((outcome) => outcome.status === 'down')
      .map(({ name, error }) => ({ name, error })),
  };
}
