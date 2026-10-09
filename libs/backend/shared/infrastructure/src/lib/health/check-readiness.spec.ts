import type { DependencyProbe } from '@taskflow/backend/shared/infrastructure';
import { checkReadiness } from './check-readiness';

const healthyProbe = (name: string): DependencyProbe => ({ name, check: async () => undefined });
const failingProbe = (name: string, error = new Error('connection refused')): DependencyProbe => ({
  name,
  check: async () => {
    throw error;
  },
});
const hangingProbe = (name: string): DependencyProbe => ({
  name,
  check: () => new Promise<void>(() => undefined),
});

describe('checkReadiness', () => {
  it('is ready when every dependency is up', async () => {
    const { report, failures } = await checkReadiness(
      [healthyProbe('postgres'), healthyProbe('redis')],
      100,
    );

    expect(report.status).toBe('ready');
    expect(report.checks.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: 'postgres', status: 'up' },
      { name: 'redis', status: 'up' },
    ]);
    expect(failures).toEqual([]);
  });

  it('is not ready when a dependency fails and keeps the error out of the report', async () => {
    const cause = new Error('password authentication failed for user "taskflow"');

    const { report, failures } = await checkReadiness(
      [healthyProbe('postgres'), failingProbe('redis', cause)],
      100,
    );

    expect(report.status).toBe('not_ready');
    expect(report.checks.find(({ name }) => name === 'redis')?.status).toBe('down');
    expect(JSON.stringify(report)).not.toContain('password');
    expect(failures).toEqual([{ name: 'redis', error: cause }]);
  });

  it('marks a dependency as down when it exceeds the timeout', async () => {
    vi.useFakeTimers();
    try {
      const pending = checkReadiness([hangingProbe('postgres')], 50);
      await vi.advanceTimersByTimeAsync(50);

      const { report, failures } = await pending;

      expect(report.status).toBe('not_ready');
      expect(failures[0]?.error).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports latency measured by the injected clock', async () => {
    const readings = [10, 25];
    const clock = () => readings.shift() ?? 25;

    const { report } = await checkReadiness([healthyProbe('postgres')], 100, clock);

    expect(report.checks[0]?.latencyMs).toBe(15);
  });
});
