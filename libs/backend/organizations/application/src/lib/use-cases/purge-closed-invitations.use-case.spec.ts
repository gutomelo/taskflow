import { FixedClock } from '@taskflow/backend/shared/application/testing';
import type { InvitationRetention } from '../ports/invitation-retention';
import {
  CLOSED_INVITATION_RETENTION_DAYS,
  PurgeClosedInvitationsUseCase,
} from './purge-closed-invitations.use-case';

describe('PurgeClosedInvitationsUseCase (RNF-08)', () => {
  it(`removes invitations closed more than ${CLOSED_INVITATION_RETENTION_DAYS} days ago`, async () => {
    const clock = new FixedClock(new Date('2026-11-30T03:00:00.000Z'));
    const cutoffs: Date[] = [];
    const retention: InvitationRetention = {
      deleteClosedBefore: async (closedBefore) => {
        cutoffs.push(closedBefore);
        return 4;
      },
    };

    const report = await new PurgeClosedInvitationsUseCase({ retention, clock }).execute();

    expect(report).toEqual({ closedInvitations: 4 });
    expect(cutoffs).toEqual([new Date('2026-10-31T03:00:00.000Z')]);
  });
});
