import type {
  OrganizationRole,
  RequestContext,
  TenantRequestContext,
} from '@taskflow/backend/shared/application';
import {
  AlreadyAMemberError,
  INVITATION_TTL_MS,
  Membership,
  Organization,
  OrganizationName,
  OrganizationSlug,
} from '@taskflow/backend/organizations/domain';
import {
  createOrganizationsTestbed,
  type OrganizationsTestbed,
} from '../../testing/organizations-fakes';
import { maskEmail } from '../shared/mask-email';
import { MAX_MEMBERSHIPS_PER_USER } from '../shared/organization-limits';
import {
  EmailNotVerifiedError,
  InvalidOrExpiredInvitationError,
  InvitationForAnotherAccountError,
  OrganizationLimitReachedError,
} from '../shared/organizations-errors';
import { AcceptInvitationUseCase } from './accept-invitation.use-case';
import { InviteMemberUseCase } from './invite-member.use-case';
import { LookupInvitationUseCase } from './lookup-invitation.use-case';
import { RevokeInvitationUseCase } from './revoke-invitation.use-case';

async function seed(
  bed: OrganizationsTestbed,
  members: ReadonlyArray<readonly [string, OrganizationRole]>,
  slug = 'acme',
) {
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

function account(bed: OrganizationsTestbed, id: string, emailVerified = true) {
  bed.users.add({ id, name: `Nome ${id}`, email: `${id}@exemplo.com`, emailVerified });
}

function contextFor(userId: string): RequestContext {
  return { requestId: 'req-2', actor: { userId, sessionId: `s-${userId}` } };
}

function as(userId: string, organizationId: string, role: OrganizationRole): TenantRequestContext {
  return { ...contextFor(userId), tenant: { organizationId, organizationRole: role } };
}

/** Convite criado pela API e token emitido pelo worker (T16). Devolve o token bruto. */
async function invite(
  bed: OrganizationsTestbed,
  organizationId: string,
  inviter: string,
  email: string,
  role: OrganizationRole = 'member',
) {
  const { invitation } = await new InviteMemberUseCase(bed).execute(
    as(inviter, organizationId, 'owner'),
    {
      email,
      role,
    },
  );
  const stored = await bed.invitations.findById(organizationId, invitation.id);
  const { token, tokenHash } = bed.tokens.generate();
  await bed.invitations.issueToken({
    invitationId: invitation.id,
    deliveryEventId: stored?.toSnapshot().deliveryEventId ?? 'none',
    tokenHash,
    now: bed.clock.now(),
  });
  return { token, invitationId: invitation.id };
}

describe('AcceptInvitationUseCase (RF-08, BR-020)', () => {
  it('CA-04: the invited, verified account becomes a member with the invitation role', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    account(bed, 'bia');
    const { token, invitationId } = await invite(bed, acme, 'ana', 'bia@exemplo.com', 'admin');

    const view = await new AcceptInvitationUseCase(bed).execute(contextFor('bia'), { token });

    expect(view).toEqual({ id: acme, name: 'Org acme', slug: 'acme', role: 'admin' });
    expect((await bed.memberships.find(acme, 'bia'))?.role).toBe('admin');
    const stored = (await bed.invitations.findById(acme, invitationId))?.toSnapshot();
    expect(stored).toMatchObject({ acceptedByUserId: 'bia', acceptedAt: bed.clock.now() });
    expect(bed.securityEvents.events.at(-1)).toEqual({
      type: 'organizations.invitation_accepted',
      requestId: 'req-2',
      organizationId: acme,
      actorUserId: 'bia',
      invitationId,
      role: 'admin',
    });
  });

  it('CA-05: another account gets 403 without consuming; the invited one still accepts', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    account(bed, 'bia');
    account(bed, 'eva');
    const { token } = await invite(bed, acme, 'ana', 'bia@exemplo.com');
    const accept = new AcceptInvitationUseCase(bed);

    await expect(accept.execute(contextFor('eva'), { token })).rejects.toBeInstanceOf(
      InvitationForAnotherAccountError,
    );
    expect(await bed.memberships.find(acme, 'eva')).toBeNull();
    await expect(accept.execute(contextFor('bia'), { token })).resolves.toMatchObject({ id: acme });
  });

  it('BR-013: an unverified account gets EMAIL_NOT_VERIFIED first, and the invitation is kept', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    account(bed, 'bia', false);
    account(bed, 'eva', false);
    const { token } = await invite(bed, acme, 'ana', 'bia@exemplo.com');
    const accept = new AcceptInvitationUseCase(bed);

    // Conta errada **e** não verificada: a verificação vem antes.
    await expect(accept.execute(contextFor('eva'), { token })).rejects.toBeInstanceOf(
      EmailNotVerifiedError,
    );
    await expect(accept.execute(contextFor('bia'), { token })).rejects.toBeInstanceOf(
      EmailNotVerifiedError,
    );
    bed.users.add({ id: 'bia', name: 'Nome bia', email: 'bia@exemplo.com', emailVerified: true });
    await expect(accept.execute(contextFor('bia'), { token })).resolves.toMatchObject({ id: acme });
  });

  it('CA-05: used, revoked, expired or unknown tokens are rejected the same way', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    for (const id of ['bia', 'caio', 'davi']) account(bed, id);
    const accept = new AcceptInvitationUseCase(bed);
    const used = await invite(bed, acme, 'ana', 'bia@exemplo.com');
    await accept.execute(contextFor('bia'), { token: used.token });
    const revoked = await invite(bed, acme, 'ana', 'caio@exemplo.com');
    await new RevokeInvitationUseCase(bed).execute(as('ana', acme, 'owner'), revoked.invitationId);
    const expired = await invite(bed, acme, 'ana', 'davi@exemplo.com');
    bed.clock.advance(INVITATION_TTL_MS);

    for (const [userId, token] of [
      ['bia', used.token],
      ['caio', revoked.token],
      ['davi', expired.token],
      ['davi', 'token-que-nao-existe'],
    ] as const) {
      await expect(accept.execute(contextFor(userId), { token })).rejects.toBeInstanceOf(
        InvalidOrExpiredInvitationError,
      );
    }
    expect(await bed.memberships.find(acme, 'caio')).toBeNull();
    expect(await bed.memberships.find(acme, 'davi')).toBeNull();
  });

  it.each([
    ['removed', null],
    ['demoted to member', 'member'],
  ] as const)('BR-021: refuses an invitation whose inviter was %s', async (_label, newRole) => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['adm', 'admin'],
    ]);
    account(bed, 'bia');
    const { token } = await invite(bed, acme, 'adm', 'bia@exemplo.com');
    // Direto no repositório: a revogação automática da T10 não roda aqui (defesa em profundidade).
    const inviter = await bed.memberships.find(acme, 'adm');
    if (!inviter) throw new Error('missing inviter');
    if (newRole) {
      inviter.changeRole(newRole, bed.clock.now());
      await bed.memberships.save(inviter);
    } else {
      await bed.memberships.remove(acme, 'adm', inviter.version);
    }

    await expect(
      new AcceptInvitationUseCase(bed).execute(contextFor('bia'), { token }),
    ).rejects.toBeInstanceOf(InvalidOrExpiredInvitationError);
    expect(await bed.memberships.find(acme, 'bia')).toBeNull();
  });

  it('BR-020: an account that is already a member gets 409 and the invitation stays open', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    account(bed, 'bia');
    const { token, invitationId } = await invite(bed, acme, 'ana', 'bia@exemplo.com');
    await bed.memberships.add(
      Membership.create({
        id: 'm-bia',
        organizationId: acme,
        userId: 'bia',
        role: 'viewer',
        now: bed.clock.now(),
      }),
    );

    await expect(
      new AcceptInvitationUseCase(bed).execute(contextFor('bia'), { token }),
    ).rejects.toBeInstanceOf(AlreadyAMemberError);
    expect((await bed.invitations.findById(acme, invitationId))?.isOpen).toBe(true);
  });

  it(`RNF-04: refuses a ${MAX_MEMBERSHIPS_PER_USER + 1}st membership without consuming`, async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    account(bed, 'bia');
    const { token, invitationId } = await invite(bed, acme, 'ana', 'bia@exemplo.com');
    for (let index = 0; index < MAX_MEMBERSHIPS_PER_USER; index += 1) {
      await bed.memberships.add(
        Membership.create({
          id: `m-${index}`,
          organizationId: `org-${index}`,
          userId: 'bia',
          role: 'viewer',
          now: bed.clock.now(),
        }),
      );
    }

    await expect(
      new AcceptInvitationUseCase(bed).execute(contextFor('bia'), { token }),
    ).rejects.toBeInstanceOf(OrganizationLimitReachedError);
    expect((await bed.invitations.findById(acme, invitationId))?.isOpen).toBe(true);
  });
});

describe('AcceptInvitationUseCase — defense in depth', () => {
  it('rejects and keeps no membership when the conditional consumption loses', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    account(bed, 'bia');
    const { token } = await invite(bed, acme, 'ana', 'bia@exemplo.com');
    // Ex.: o e-mail da conta mudou entre a leitura e o `UPDATE` condicionado a ele.
    vi.spyOn(bed.invitations, 'consume').mockResolvedValue(null);

    await expect(
      new AcceptInvitationUseCase(bed).execute(contextFor('bia'), { token }),
    ).rejects.toBeInstanceOf(InvalidOrExpiredInvitationError);
    expect(await bed.memberships.find(acme, 'bia')).toBeNull();
  });
});

describe('LookupInvitationUseCase (RF-08)', () => {
  it('previews the invitation with a masked e-mail, for any authenticated account', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    account(bed, 'bia', false);
    account(bed, 'eva');
    const { token } = await invite(bed, acme, 'ana', 'bia@exemplo.com', 'viewer');
    const lookup = new LookupInvitationUseCase(bed);

    const forBia = await lookup.execute(contextFor('bia'), { token });
    const forEva = await lookup.execute(contextFor('eva'), { token });

    expect(forBia).toEqual({
      organizationName: 'Org acme',
      role: 'viewer',
      invitedByName: 'Nome ana',
      maskedEmail: 'b***@exemplo.com',
      isForCurrentUser: true,
      expiresAt: new Date(bed.clock.now().getTime() + INVITATION_TTL_MS),
    });
    expect(forEva.isForCurrentUser).toBe(false);
    expect(JSON.stringify(forEva)).not.toContain('bia@');
    expect(
      await bed.invitations.findUsableByTokenHash(bed.tokens.hash(token), bed.clock.now()),
    ).not.toBeNull();
  });

  it('rejects an unknown or expired token', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    const { token } = await invite(bed, acme, 'ana', 'bia@exemplo.com');
    const lookup = new LookupInvitationUseCase(bed);
    bed.clock.advance(INVITATION_TTL_MS);

    await expect(lookup.execute(contextFor('ana'), { token })).rejects.toBeInstanceOf(
      InvalidOrExpiredInvitationError,
    );
    await expect(lookup.execute(contextFor('ana'), { token: 'x' })).rejects.toBeInstanceOf(
      InvalidOrExpiredInvitationError,
    );
  });

  it.each([
    ['bia.souza@exemplo.com', 'b***@exemplo.com'],
    ['a@x.io', 'a***@x.io'],
    ['sem-arroba', '***'],
  ])('masks %s as %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });
});
