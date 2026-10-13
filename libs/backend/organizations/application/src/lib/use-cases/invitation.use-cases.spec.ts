import {
  RateLimitedError,
  type OrganizationRole,
  type TenantRequestContext,
} from '@taskflow/backend/shared/application';
import { EmailAddress, InvalidEmailAddressError } from '@taskflow/backend/shared/kernel';
import {
  AlreadyAMemberError,
  INVITATION_TTL_MS,
  InvalidInvitationRoleError,
  Membership,
  Organization,
  OrganizationName,
  OrganizationSlug,
} from '@taskflow/backend/organizations/domain';
import {
  createOrganizationsTestbed,
  type OrganizationsTestbed,
} from '../../testing/organizations-fakes';
import { INVITATION_POLICIES } from '../shared/invitation-limits';
import { InsufficientRoleError, InvitationNotFoundError } from '../shared/organizations-errors';
import { OrganizationsEventType } from '../shared/organizations-events';
import { InviteMemberUseCase } from './invite-member.use-case';
import { ListInvitationsUseCase } from './list-invitations.use-case';
import { ResendInvitationUseCase } from './resend-invitation.use-case';
import { RevokeInvitationUseCase } from './revoke-invitation.use-case';

type Members = ReadonlyArray<readonly [string, OrganizationRole]>;

async function seed(bed: OrganizationsTestbed, members: Members, slug = 'acme') {
  const now = bed.clock.now();
  const organization = Organization.create({
    id: bed.idGenerator.generate(),
    name: OrganizationName.create(`Org ${slug}`),
    slug: OrganizationSlug.create(slug),
    now,
  });
  await bed.organizations.add(organization);
  for (const [userId, role] of members) {
    bed.users.add({
      id: userId,
      name: `Nome ${userId}`,
      email: `${userId}@exemplo.com`,
      emailVerified: true,
    });
    await bed.memberships.add(
      Membership.create({
        id: bed.idGenerator.generate(),
        organizationId: organization.id,
        userId,
        role,
        now,
      }),
    );
  }
  return organization.id;
}

function as(userId: string, organizationId: string, role: OrganizationRole): TenantRequestContext {
  return {
    requestId: 'req-1',
    actor: { userId, sessionId: `s-${userId}` },
    tenant: { organizationId, organizationRole: role },
  };
}

/** Simula a passagem de 10 minutos para o limite por (organização, e-mail). */
function afterTenMinutes(bed: OrganizationsTestbed) {
  for (const key of bed.rateLimiter.keys()) {
    if (key.startsWith(`${INVITATION_POLICIES.perOrganizationEmail.name}|`))
      bed.rateLimiter.consumed.delete(key);
  }
  bed.clock.advance(10 * 60 * 1000);
}

/** Simula o worker emitindo o token do envio vigente (T16). */
async function issueCurrentToken(
  bed: OrganizationsTestbed,
  organizationId: string,
  invitationId: string,
  tokenHash: string,
) {
  const invitation = await bed.invitations.findById(organizationId, invitationId);
  return bed.invitations.issueToken({
    invitationId,
    deliveryEventId: invitation?.toSnapshot().deliveryEventId ?? 'none',
    tokenHash,
    now: bed.clock.now(),
  });
}

describe('InviteMemberUseCase (RF-06)', () => {
  it('creates a pending invitation and queues one e-mail whose event is the delivery id', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);

    const result = await new InviteMemberUseCase(bed).execute(as('ana', acme, 'owner'), {
      email: ' Bia@Exemplo.com ',
      role: 'member',
    });

    expect(result.created).toBe(true);
    expect(result.invitation).toEqual({
      id: expect.any(String),
      email: 'bia@exemplo.com',
      role: 'member',
      status: 'pending',
      invitedBy: { userId: 'ana', name: 'Nome ana' },
      expiresAt: new Date(bed.clock.now().getTime() + INVITATION_TTL_MS),
      createdAt: bed.clock.now(),
    });
    const stored = await bed.invitations.findById(acme, result.invitation.id);
    expect(bed.outbox.events).toEqual([
      expect.objectContaining({
        id: stored?.toSnapshot().deliveryEventId,
        type: OrganizationsEventType.invitationRequested,
        payload: { invitationId: result.invitation.id },
      }),
    ]);
    expect(bed.organizations.locks).toEqual([acme]);
    expect(bed.securityEvents.events).toEqual([
      {
        type: 'organizations.invitation_created',
        requestId: 'req-1',
        organizationId: acme,
        actorUserId: 'ana',
        invitationId: result.invitation.id,
        role: 'member',
      },
    ]);
    expect(JSON.stringify(bed.securityEvents.events)).not.toContain('bia@');
  });

  it('answers identically whether the invited e-mail has an account or not', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    bed.users.add({ id: 'caio', name: 'Caio', email: 'caio@exemplo.com', emailVerified: true });
    const invite = new InviteMemberUseCase(bed);

    const withAccount = await invite.execute(as('ana', acme, 'owner'), {
      email: 'caio@exemplo.com',
      role: 'viewer',
    });
    const without = await invite.execute(as('ana', acme, 'owner'), {
      email: 'nova@exemplo.com',
      role: 'viewer',
    });

    const shape = (result: typeof withAccount) => ({
      ...result,
      invitation: { ...result.invitation, id: 'x', email: 'x' },
    });
    expect(shape(withAccount)).toEqual(shape(without));
    expect(bed.outbox.events).toHaveLength(2);
  });

  it('RF-06: re-inviting an open invitation updates the role and resends, invalidating the old link', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['adm', 'admin'],
    ]);
    const invite = new InviteMemberUseCase(bed);
    const first = await invite.execute(as('ana', acme, 'owner'), {
      email: 'bia@exemplo.com',
      role: 'viewer',
    });
    await issueCurrentToken(bed, acme, first.invitation.id, 'old-token');
    afterTenMinutes(bed);

    const again = await invite.execute(as('adm', acme, 'admin'), {
      email: 'bia@exemplo.com',
      role: 'admin',
    });

    expect(again.created).toBe(false);
    expect(again.invitation).toMatchObject({
      id: first.invitation.id,
      role: 'admin',
      invitedBy: { userId: 'adm', name: 'Nome adm' },
      expiresAt: new Date(bed.clock.now().getTime() + INVITATION_TTL_MS),
    });
    expect(bed.invitations.rows.size).toBe(1);
    expect(await bed.invitations.findUsableByTokenHash('old-token', bed.clock.now())).toBeNull();
    expect(bed.outbox.events).toHaveLength(2);
    expect(bed.securityEvents.types()).toEqual([
      'organizations.invitation_created',
      'organizations.invitation_resent',
    ]);
  });

  it('BR-020: refuses an e-mail that already belongs to a member, sending nothing', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'member'],
    ]);

    await expect(
      new InviteMemberUseCase(bed).execute(as('ana', acme, 'owner'), {
        email: 'bia@exemplo.com',
        role: 'admin',
      }),
    ).rejects.toBeInstanceOf(AlreadyAMemberError);
    expect(bed.invitations.rows.size).toBe(0);
    expect(bed.outbox.events).toEqual([]);
  });

  it('BR-021: never invites as owner, and rejects bad input before spending any limit', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    const invite = new InviteMemberUseCase(bed);

    await expect(
      invite.execute(as('ana', acme, 'owner'), { email: 'bia@exemplo.com', role: 'owner' }),
    ).rejects.toBeInstanceOf(InvalidInvitationRoleError);
    await expect(
      invite.execute(as('ana', acme, 'owner'), { email: 'não é e-mail', role: 'member' }),
    ).rejects.toBeInstanceOf(InvalidEmailAddressError);
    expect(bed.rateLimiter.keys()).toEqual([]);
  });

  it.each<OrganizationRole>(['member', 'viewer'])(
    'denies a %s before taking the lock',
    async (role) => {
      const bed = createOrganizationsTestbed();
      const acme = await seed(bed, [
        ['ana', 'owner'],
        ['bia', role],
      ]);

      await expect(
        new InviteMemberUseCase(bed).execute(as('bia', acme, role), {
          email: 'x@exemplo.com',
          role: 'viewer',
        }),
      ).rejects.toBeInstanceOf(InsufficientRoleError);
      expect(bed.organizations.locks).toEqual([]);
    },
  );

  it('decides on the inviter role re-read under the lock', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['adm', 'member'],
    ]);

    await expect(
      new InviteMemberUseCase(bed).execute(as('adm', acme, 'admin'), {
        email: 'x@exemplo.com',
        role: 'viewer',
      }),
    ).rejects.toBeInstanceOf(InsufficientRoleError);
    expect(bed.invitations.rows.size).toBe(0);
  });

  it('CA-12: one invitation per (organization, e-mail) every 10 minutes, revoke+recreate included', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    const invite = new InviteMemberUseCase(bed);
    const first = await invite.execute(as('ana', acme, 'owner'), {
      email: 'bia@exemplo.com',
      role: 'viewer',
    });
    await new RevokeInvitationUseCase(bed).execute(as('ana', acme, 'owner'), first.invitation.id);

    const again = invite.execute(as('ana', acme, 'owner'), {
      email: 'bia@exemplo.com',
      role: 'viewer',
    });

    await expect(again).rejects.toBeInstanceOf(RateLimitedError);
    await expect(again).rejects.toMatchObject({ retryAfterSeconds: 600 });
    expect(bed.invitations.rows.size).toBe(1);
    afterTenMinutes(bed);
    await expect(
      invite.execute(as('ana', acme, 'owner'), { email: 'bia@exemplo.com', role: 'viewer' }),
    ).resolves.toMatchObject({ created: true });
  });

  it.each([
    ['account', INVITATION_POLICIES.perAccount],
    ['organization', INVITATION_POLICIES.perOrganization],
  ] as const)('CA-12: answers 429 past the per-%s budget', async (_label, policy) => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    const invite = new InviteMemberUseCase(bed);
    const key = policy === INVITATION_POLICIES.perAccount ? 'ana' : acme;
    bed.rateLimiter.consumed.set(`${policy.name}|${key}`, policy.points);

    await expect(
      invite.execute(as('ana', acme, 'owner'), { email: 'bia@exemplo.com', role: 'viewer' }),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(bed.organizations.locks).toEqual([]);
  });

  /** Convida o alvo e reenvia `resends` vezes (cada envio a 10 min do anterior). */
  async function deliveries(
    bed: OrganizationsTestbed,
    organizationId: string,
    owner: string,
    resends: number,
  ) {
    const { invitation } = await new InviteMemberUseCase(bed).execute(
      as(owner, organizationId, 'owner'),
      {
        email: 'alvo@exemplo.com',
        role: 'viewer',
      },
    );
    for (let index = 0; index < resends; index += 1) {
      afterTenMinutes(bed);
      await new ResendInvitationUseCase(bed).execute(
        as(owner, organizationId, 'owner'),
        invitation.id,
      );
    }
    return invitation;
  }

  const queuedFor = (bed: OrganizationsTestbed, invitationId: string) =>
    bed.outbox.events.filter((event) => event.payload['invitationId'] === invitationId).length;

  it('CA-12 (rev. 4): past 3 e-mails a day from one organization to one recipient, answers the same but sends nothing', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);

    const invitation = await deliveries(bed, acme, 'ana', 3);

    expect(queuedFor(bed, invitation.id)).toBe(3);
    expect((await bed.invitations.findById(acme, invitation.id))?.isOpen).toBe(true);
    expect(JSON.stringify(bed.rateLimiter.keys())).not.toContain('alvo@');
  });

  it('M1 (rev. 4): one organization exhausting its quota for an address does not block another', async () => {
    const bed = createOrganizationsTestbed();
    const attacker = await seed(bed, [['mal', 'owner']], 'atacante');
    const victimOrg = await seed(bed, [['ana', 'owner']], 'legitima');
    await deliveries(bed, attacker, 'mal', 5);

    const legit = await deliveries(bed, victimOrg, 'ana', 0);

    expect(queuedFor(bed, legit.id)).toBe(1);
  });

  it('CA-12 (rev. 4): the global ceiling of 20 e-mails a day per recipient suppresses the 21st', async () => {
    const bed = createOrganizationsTestbed();
    const sent: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      const slug = `org-${String.fromCharCode(97 + index)}`;
      const organizationId = await seed(bed, [[`owner-${slug}`, 'owner']], slug);
      const invitation = await deliveries(bed, organizationId, `owner-${slug}`, 2);
      sent.push(queuedFor(bed, invitation.id));
    }

    expect(sent).toEqual([3, 3, 3, 3, 3, 3, 2]);
  });
});

describe('ResendInvitationUseCase (RF-07, CA-06)', () => {
  it('CA-06: a resend invalidates the previous link and renews the deadline', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['adm', 'admin'],
    ]);
    const { invitation } = await new InviteMemberUseCase(bed).execute(as('ana', acme, 'owner'), {
      email: 'bia@exemplo.com',
      role: 'member',
    });
    await issueCurrentToken(bed, acme, invitation.id, 'old-token');
    afterTenMinutes(bed);

    await new ResendInvitationUseCase(bed).execute(as('adm', acme, 'admin'), invitation.id);

    expect(await bed.invitations.findUsableByTokenHash('old-token', bed.clock.now())).toBeNull();
    const stored = (await bed.invitations.findById(acme, invitation.id))?.toSnapshot();
    expect(stored).toMatchObject({
      invitedByUserId: 'adm',
      role: 'member',
      expiresAt: new Date(bed.clock.now().getTime() + INVITATION_TTL_MS),
    });
    expect(bed.outbox.events.at(-1)?.id).toBe(stored?.deliveryEventId);
    expect(await issueCurrentToken(bed, acme, invitation.id, 'new-token')).toBe(true);
    expect(bed.securityEvents.types().at(-1)).toBe('organizations.invitation_resent');
  });

  it('CA-12: allows one resend per 10 minutes for the same e-mail', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    const { invitation } = await new InviteMemberUseCase(bed).execute(as('ana', acme, 'owner'), {
      email: 'bia@exemplo.com',
      role: 'member',
    });

    await expect(
      new ResendInvitationUseCase(bed).execute(as('ana', acme, 'owner'), invitation.id),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(bed.outbox.events).toHaveLength(1);
  });

  it('answers 404 for a revoked invitation or one of another organization', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    const beta = await seed(bed, [['zeca', 'owner']], 'beta');
    const { invitation } = await new InviteMemberUseCase(bed).execute(as('zeca', beta, 'owner'), {
      email: 'bia@exemplo.com',
      role: 'member',
    });
    const resend = new ResendInvitationUseCase(bed);

    await expect(resend.execute(as('ana', acme, 'owner'), invitation.id)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
    await new RevokeInvitationUseCase(bed).execute(as('zeca', beta, 'owner'), invitation.id);
    afterTenMinutes(bed);
    await expect(resend.execute(as('zeca', beta, 'owner'), invitation.id)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });
});

describe('RevokeInvitationUseCase (RF-07, CA-06)', () => {
  it('CA-06: a revoked invitation can no longer be accepted', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    const { invitation } = await new InviteMemberUseCase(bed).execute(as('ana', acme, 'owner'), {
      email: 'bia@exemplo.com',
      role: 'member',
    });
    await issueCurrentToken(bed, acme, invitation.id, 'token');
    const revoke = new RevokeInvitationUseCase(bed);

    await revoke.execute(as('ana', acme, 'owner'), invitation.id);

    expect(await bed.invitations.findUsableByTokenHash('token', bed.clock.now())).toBeNull();
    expect(
      await bed.invitations.consume({
        tokenHash: 'token',
        email: EmailAddress.create('bia@exemplo.com'),
        acceptedByUserId: 'bia',
        now: bed.clock.now(),
      }),
    ).toBeNull();
    await expect(revoke.execute(as('ana', acme, 'owner'), invitation.id)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
    expect(bed.securityEvents.types().at(-1)).toBe('organizations.invitation_revoked');
  });

  it('denies members and ids of another organization, changing nothing', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'member'],
    ]);
    const beta = await seed(bed, [['zeca', 'owner']], 'beta');
    const { invitation } = await new InviteMemberUseCase(bed).execute(as('zeca', beta, 'owner'), {
      email: 'x@exemplo.com',
      role: 'member',
    });
    const revoke = new RevokeInvitationUseCase(bed);

    await expect(revoke.execute(as('bia', acme, 'member'), invitation.id)).rejects.toBeInstanceOf(
      InsufficientRoleError,
    );
    await expect(revoke.execute(as('ana', acme, 'owner'), invitation.id)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
    expect((await bed.invitations.findById(beta, invitation.id))?.isOpen).toBe(true);
  });
});

describe('ListInvitationsUseCase (RF-07)', () => {
  it('lists open invitations, pending and expired, with the inviter in one batch', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['adm', 'admin'],
    ]);
    const invite = new InviteMemberUseCase(bed);
    const old = await invite.execute(as('ana', acme, 'owner'), {
      email: 'velho@exemplo.com',
      role: 'viewer',
    });
    bed.clock.advance(INVITATION_TTL_MS - 1000);
    await invite.execute(as('adm', acme, 'admin'), { email: 'novo@exemplo.com', role: 'member' });
    const revoked = await invite.execute(as('ana', acme, 'owner'), {
      email: 'fora@exemplo.com',
      role: 'member',
    });
    await new RevokeInvitationUseCase(bed).execute(as('ana', acme, 'owner'), revoked.invitation.id);
    bed.clock.advance(2000);
    bed.users.queries.length = 0;

    const page = await new ListInvitationsUseCase(bed).execute(as('adm', acme, 'admin'), {});

    expect(page.items.map((item) => [item.email, item.status, item.invitedBy.name])).toEqual([
      ['velho@exemplo.com', 'expired', 'Nome ana'],
      ['novo@exemplo.com', 'pending', 'Nome adm'],
    ]);
    expect(page.items[0]?.id).toBe(old.invitation.id);
    expect(bed.users.queries).toHaveLength(1);
  });

  it.each<OrganizationRole>(['member', 'viewer'])('forbids the %s', async (role) => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', role],
    ]);

    await expect(
      new ListInvitationsUseCase(bed).execute(as('bia', acme, role), {}),
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});
