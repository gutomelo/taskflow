import { readinessReportSchema } from './health.contract';

describe('readinessReportSchema', () => {
  it('accepts a report with dependency checks', () => {
    const result = readinessReportSchema.safeParse({
      status: 'ready',
      checks: [{ name: 'postgres', status: 'up', latencyMs: 3 }],
    });

    expect(result.success).toBe(true);
  });

  it('rejects unknown dependency statuses', () => {
    const result = readinessReportSchema.safeParse({
      status: 'ready',
      checks: [{ name: 'postgres', status: 'degraded', latencyMs: 3 }],
    });

    expect(result.success).toBe(false);
  });
});
