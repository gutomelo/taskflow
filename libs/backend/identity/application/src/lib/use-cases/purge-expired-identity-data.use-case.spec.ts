import type { IdentityDataRetention } from '../ports/identity-data-retention';
import { PurgeExpiredIdentityDataUseCase } from './purge-expired-identity-data.use-case';

const NOW = new Date('2026-10-09T03:00:00.000Z');
const daysBefore = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

function recordingRetention() {
  const calls: string[] = [];
  const retention: IdentityDataRetention = {
    deleteUnverifiedUsers: vi.fn(async () => {
      calls.push('users');
      return 2;
    }),
    deleteSessionsEndedBefore: vi.fn(async () => {
      calls.push('sessions');
      return 5;
    }),
    deleteUserTokensEndedBefore: vi.fn(async () => {
      calls.push('tokens');
      return 7;
    }),
  };
  return { retention, calls };
}

describe('PurgeExpiredIdentityDataUseCase', () => {
  it('applies the spec retention periods and reports what was removed', async () => {
    const { retention } = recordingRetention();
    const purge = new PurgeExpiredIdentityDataUseCase({ retention, clock: { now: () => NOW } });

    const report = await purge.execute();

    expect(report).toEqual({ unverifiedUsers: 2, sessions: 5, userTokens: 7 });
    // RF-15: criadas há mais de 7 dias e sem login nesses 7 dias.
    expect(retention.deleteUnverifiedUsers).toHaveBeenCalledWith({
      createdBefore: daysBefore(7),
      noActivitySince: daysBefore(7),
    });
    expect(retention.deleteSessionsEndedBefore).toHaveBeenCalledWith(daysBefore(30));
    expect(retention.deleteUserTokensEndedBefore).toHaveBeenCalledWith(daysBefore(7));
  });

  it('removes unverified accounts first, so their sessions and tokens go by cascade', async () => {
    const { retention, calls } = recordingRetention();

    await new PurgeExpiredIdentityDataUseCase({ retention, clock: { now: () => NOW } }).execute();

    expect(calls[0]).toBe('users');
  });
});
