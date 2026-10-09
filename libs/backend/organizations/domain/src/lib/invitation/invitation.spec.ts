import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { InvalidInvitationRoleError } from '../errors';
import { Invitation, INVITATION_TTL_MS } from './invitation';

const T0 = new Date('2026-10-09T12:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

function invite(role: 'admin' | 'member' | 'viewer' | 'owner' = 'member') {
  return Invitation.create({
    id: 'inv-1',
    organizationId: 'org-1',
    email: EmailAddress.create('bia@exemplo.com'),
    role,
    invitedByUserId: 'ana',
    deliveryEventId: 'event-1',
    now: T0,
  });
}

describe('Invitation (BR-020, BR-021)', () => {
  it('BR-020: expires 7 days after it was sent', () => {
    const invitation = invite();
    expect(invitation.toSnapshot().expiresAt).toEqual(later(INVITATION_TTL_MS));
    expect(invitation.isExpired(later(INVITATION_TTL_MS - 1))).toBe(false);
    expect(invitation.isExpired(later(INVITATION_TTL_MS))).toBe(true);
  });

  it('BR-021: never grants the owner role', () => {
    expect(() => invite('owner')).toThrow(InvalidInvitationRoleError);
    expect(() =>
      invite().redeliver({ deliveryEventId: 'e2', role: 'owner', invitedByUserId: 'ana', now: T0 }),
    ).toThrow(InvalidInvitationRoleError);
  });

  it('re-delivery renews the deadline, records the new event and may change the role', () => {
    const invitation = invite();
    invitation.redeliver({
      deliveryEventId: 'event-2',
      role: 'admin',
      invitedByUserId: 'carlos',
      now: later(1_000),
    });

    expect(invitation.toSnapshot()).toMatchObject({
      role: 'admin',
      deliveryEventId: 'event-2',
      invitedByUserId: 'carlos',
      expiresAt: later(1_000 + INVITATION_TTL_MS),
    });
  });

  it('revocation is idempotent and closes the invitation', () => {
    const invitation = invite();
    invitation.revoke(later(1));
    invitation.revoke(later(2));

    expect(invitation.isOpen).toBe(false);
    expect(invitation.toSnapshot().revokedAt).toEqual(later(1));
  });
});
