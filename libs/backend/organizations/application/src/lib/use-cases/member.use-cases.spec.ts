import type { OrganizationRole, TenantRequestContext } from '@taskflow/backend/shared/application';
import { EmailAddress, VersionConflictError } from '@taskflow/backend/shared/kernel';
import {
  Invitation,
  LastOwnerError,
  Membership,
  Organization,
  OrganizationName,
  OrganizationSlug,
  RoleChangeNotAllowedError,
} from '@taskflow/backend/organizations/domain';
import {
  createOrganizationsTestbed,
  type OrganizationsTestbed,
} from '../../testing/organizations-fakes';
import {
  InsufficientRoleError,
  MemberNotFoundError,
  OrganizationNotFoundError,
} from '../shared/organizations-errors';
import { MAX_PAGE_SIZE } from '../shared/pagination';
import { ChangeMemberRoleUseCase } from './change-member-role.use-case';
import { ListMembersUseCase } from './list-members.use-case';
import { RemoveMemberUseCase } from './remove-member.use-case';
import { ResolveTenantMembershipUseCase } from './resolve-tenant-membership.use-case';

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

async function roleOf(bed: OrganizationsTestbed, organizationId: string, userId: string) {
  return (await bed.memberships.find(organizationId, userId))?.role ?? null;
}

async function inviteFrom(
  bed: OrganizationsTestbed,
  organizationId: string,
  invitedByUserId: string,
  email: string,
) {
  const invitation = Invitation.create({
    id: bed.idGenerator.generate(),
    organizationId,
    email: EmailAddress.create(email),
    role: 'member',
    invitedByUserId,
    deliveryEventId: bed.idGenerator.generate(),
    now: bed.clock.now(),
  });
  await bed.invitations.add(invitation);
  return invitation.id;
}

async function isOpen(bed: OrganizationsTestbed, organizationId: string, invitationId: string) {
  return (await bed.invitations.findById(organizationId, invitationId))?.isOpen ?? false;
}

describe('ListMembersUseCase (RF-09)', () => {
  it('pages members with name, e-mail and role, one directory query per page', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'member'],
      ['caio', 'viewer'],
    ]);
    await seed(bed, [['zeca', 'owner']], 'outra');
    bed.users.queries.length = 0;
    const list = new ListMembersUseCase(bed);

    const first = await list.execute(as('bia', acme, 'member'), { limit: 2 });
    const second = await list.execute(as('bia', acme, 'member'), {
      limit: 2,
      cursor: first.nextCursor,
    });

    expect(first.items).toEqual([
      {
        userId: 'ana',
        name: 'Nome ana',
        email: 'ana@exemplo.com',
        role: 'owner',
        version: 1,
        joinedAt: bed.clock.now(),
        actions: { changeRoleTo: [], remove: false },
      },
      {
        userId: 'bia',
        name: 'Nome bia',
        email: 'bia@exemplo.com',
        role: 'member',
        version: 1,
        joinedAt: bed.clock.now(),
        actions: { changeRoleTo: [], remove: false },
      },
    ]);
    expect(second.items.map((member) => member.userId)).toEqual(['caio']);
    expect(second.nextCursor).toBeNull();
    expect(bed.users.queries).toEqual([['ana', 'bia'], ['caio']]);
  });

  it(`caps the page at ${MAX_PAGE_SIZE} and keeps a member whose account vanished`, async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'owner']]);
    bed.users.accounts.delete('ana');
    const listPage = vi.spyOn(bed.memberships, 'listPage');

    const page = await new ListMembersUseCase(bed).execute(as('ana', acme, 'owner'), {
      limit: 1000,
    });

    expect(listPage).toHaveBeenCalledWith(acme, { limit: MAX_PAGE_SIZE, cursor: null });
    expect(page.items).toEqual([
      expect.objectContaining({ userId: 'ana', name: null, email: null }),
    ]);
  });

  it('RF-01: denies a role without organization:read before touching the repository', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'member']]);
    const listPage = vi.spyOn(bed.memberships, 'listPage');
    const context = as('ana', acme, 'member');
    // Papel fora do catálogo em runtime (dado corrompido): nenhum papel válido nega a leitura.
    Reflect.set(context.tenant, 'organizationRole', 'guest');

    await expect(new ListMembersUseCase(bed).execute(context, {})).rejects.toBeInstanceOf(
      InsufficientRoleError,
    );
    expect(listPage).not.toHaveBeenCalled();
  });
});

describe('ChangeMemberRole × projects (spec 003, port MembershipRoleChanges)', () => {
  it('notifies every role change inside the transaction and counts capped participations in the event', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'member'],
    ]);
    bed.membershipRoleChanges.affected = 2;
    const insideTransaction: boolean[] = [];
    const roleChanged = bed.membershipRoleChanges.roleChanged.bind(bed.membershipRoleChanges);
    vi.spyOn(bed.membershipRoleChanges, 'roleChanged').mockImplementation(async (change) => {
      insideTransaction.push(bed.transactions.inTransaction);
      return roleChanged(change);
    });

    await new ChangeMemberRoleUseCase(bed).execute(as('ana', acme, 'owner'), {
      userId: 'bia',
      role: 'viewer',
      version: 1,
    });

    expect(bed.membershipRoleChanges.changes).toEqual([
      { organizationId: acme, userId: 'bia', fromRole: 'member', toRole: 'viewer' },
    ]);
    expect(insideTransaction).toEqual([true]);
    expect(bed.securityEvents.events.at(-1)).toMatchObject({ cappedProjectParticipations: 2 });
  });

  it('does not notify when the role stays the same', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'member'],
    ]);

    await new ChangeMemberRoleUseCase(bed).execute(as('ana', acme, 'owner'), {
      userId: 'bia',
      role: 'member',
      version: 1,
    });

    expect(bed.membershipRoleChanges.changes).toEqual([]);
  });

  it('a failure while reacting rolls the role change back (same transaction)', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'member'],
    ]);
    vi.spyOn(bed.membershipRoleChanges, 'roleChanged').mockRejectedValue(new Error('boom'));

    await expect(
      new ChangeMemberRoleUseCase(bed).execute(as('ana', acme, 'owner'), {
        userId: 'bia',
        role: 'viewer',
        version: 1,
      }),
    ).rejects.toThrow('boom');
    expect(await roleOf(bed, acme, 'bia')).toBe('member');
    expect(bed.securityEvents.events).toEqual([]);
  });
});

describe('member actions (spec 006, CA-05)', () => {
  it('an admin listing members gets no actions on owners and the allowed roles for others', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['eva', 'owner'],
      ['adm', 'admin'],
      ['bia', 'member'],
    ]);

    const page = await new ListMembersUseCase(bed).execute(as('adm', acme, 'admin'), {});
    const actions = Object.fromEntries(page.items.map((item) => [item.userId, item.actions]));

    expect(actions).toEqual({
      ana: { changeRoleTo: [], remove: false },
      eva: { changeRoleTo: [], remove: false },
      adm: { changeRoleTo: [], remove: false },
      bia: { changeRoleTo: ['admin', 'viewer'], remove: true },
    });
  });

  it('computes the returned actions with the actor role re-read under the lock', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'member'],
    ]);

    // O middleware viu "admin" (promovida a owner depois); as ações seguem o papel relido.
    const view = await new ChangeMemberRoleUseCase(bed).execute(as('ana', acme, 'admin'), {
      userId: 'bia',
      role: 'viewer',
      version: 1,
    });

    expect(view.actions.changeRoleTo).toContain('owner');
  });

  it('after stepping down, the returned actions use the new role of the actor', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['eva', 'owner'],
    ]);

    const view = await new ChangeMemberRoleUseCase(bed).execute(as('ana', acme, 'owner'), {
      userId: 'ana',
      role: 'admin',
      version: 1,
    });

    // Admin não altera o próprio papel: nenhuma ação sobre si.
    expect(view.actions).toEqual({ changeRoleTo: [], remove: false });
  });
});

describe('ChangeMemberRoleUseCase (RF-10, BR-021, BR-019)', () => {
  it('CA-07: the owner promotes a member to owner, under the organization lock', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'member'],
    ]);

    const view = await new ChangeMemberRoleUseCase(bed).execute(as('ana', acme, 'owner'), {
      userId: 'bia',
      role: 'owner',
      version: 1,
    });

    expect(view).toMatchObject({
      userId: 'bia',
      role: 'owner',
      version: 2,
      email: 'bia@exemplo.com',
    });
    expect(await roleOf(bed, acme, 'bia')).toBe('owner');
    expect(bed.organizations.locks).toEqual([acme]);
    expect(bed.securityEvents.events).toEqual([
      {
        type: 'organizations.member_role_changed',
        requestId: 'req-1',
        organizationId: acme,
        actorUserId: 'ana',
        targetUserId: 'bia',
        fromRole: 'member',
        toRole: 'owner',
        revokedInvitations: 0,
        cappedProjectParticipations: 0,
      },
    ]);
  });

  it('CA-07: an admin manages admin/member/viewer but never promotes to owner nor touches owners', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['eva', 'owner'],
      ['adm', 'admin'],
      ['bia', 'member'],
    ]);
    const change = new ChangeMemberRoleUseCase(bed);
    const admin = as('adm', acme, 'admin');

    await change.execute(admin, { userId: 'bia', role: 'viewer', version: 1 });
    await expect(
      change.execute(admin, { userId: 'bia', role: 'owner', version: 2 }),
    ).rejects.toBeInstanceOf(RoleChangeNotAllowedError);
    await expect(
      change.execute(admin, { userId: 'ana', role: 'admin', version: 1 }),
    ).rejects.toBeInstanceOf(RoleChangeNotAllowedError);
    await expect(
      change.execute(admin, { userId: 'adm', role: 'member', version: 1 }),
    ).rejects.toBeInstanceOf(RoleChangeNotAllowedError);
    expect([
      await roleOf(bed, acme, 'ana'),
      await roleOf(bed, acme, 'adm'),
      await roleOf(bed, acme, 'bia'),
    ]).toEqual(['owner', 'admin', 'viewer']);
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
        new ChangeMemberRoleUseCase(bed).execute(as('bia', acme, role), {
          userId: 'ana',
          role: 'viewer',
          version: 1,
        }),
      ).rejects.toBeInstanceOf(InsufficientRoleError);
      expect(bed.organizations.locks).toEqual([]);
    },
  );

  it('CA-08: demoting the only owner answers LAST_OWNER, whoever asks', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['adm', 'admin'],
    ]);

    await expect(
      new ChangeMemberRoleUseCase(bed).execute(as('adm', acme, 'admin'), {
        userId: 'ana',
        role: 'member',
        version: 1,
      }),
    ).rejects.toBeInstanceOf(LastOwnerError);
    expect(await roleOf(bed, acme, 'ana')).toBe('owner');
  });

  it('CA-08: the last owner cannot step down; with a second owner it can', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'member'],
    ]);
    const change = new ChangeMemberRoleUseCase(bed);

    await expect(
      change.execute(as('ana', acme, 'owner'), { userId: 'ana', role: 'admin', version: 1 }),
    ).rejects.toBeInstanceOf(LastOwnerError);
    await change.execute(as('ana', acme, 'owner'), { userId: 'bia', role: 'owner', version: 1 });
    await change.execute(as('ana', acme, 'owner'), { userId: 'ana', role: 'admin', version: 1 });

    expect(await roleOf(bed, acme, 'ana')).toBe('admin');
    expect(await bed.memberships.countOwners(acme)).toBe(1);
  });

  it('decides on the actor role re-read under the lock, not on the middleware role', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['adm', 'member'],
      ['bia', 'member'],
    ]);
    const change = new ChangeMemberRoleUseCase(bed);

    // O middleware ainda viu "admin", mas `adm` foi rebaixado antes da transação.
    await expect(
      change.execute(as('adm', acme, 'admin'), { userId: 'bia', role: 'admin', version: 1 }),
    ).rejects.toBeInstanceOf(RoleChangeNotAllowedError);
    // E, removido, deixa de enxergar a organização.
    await bed.memberships.remove(acme, 'adm', 1);
    await expect(
      change.execute(as('adm', acme, 'admin'), { userId: 'bia', role: 'viewer', version: 1 }),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError);
    expect(await roleOf(bed, acme, 'bia')).toBe('member');
  });

  it('BR-008 and 404: refuses a stale version and a target outside the organization', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'member'],
    ]);
    await seed(bed, [['zeca', 'member']], 'outra');
    const change = new ChangeMemberRoleUseCase(bed);
    const owner = as('ana', acme, 'owner');

    await expect(
      change.execute(owner, { userId: 'bia', role: 'viewer', version: 7 }),
    ).rejects.toBeInstanceOf(VersionConflictError);
    await expect(
      change.execute(owner, { userId: 'zeca', role: 'viewer', version: 1 }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it('revokes the open invitations of someone who can no longer invite, only then', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['own2', 'owner'],
      ['adm', 'admin'],
    ]);
    const fromAdmin = await inviteFrom(bed, acme, 'adm', 'x@exemplo.com');
    const fromOwner = await inviteFrom(bed, acme, 'own2', 'y@exemplo.com');
    const change = new ChangeMemberRoleUseCase(bed);

    await change.execute(as('ana', acme, 'owner'), { userId: 'own2', role: 'admin', version: 1 });
    await change.execute(as('ana', acme, 'owner'), { userId: 'adm', role: 'member', version: 1 });

    expect(await isOpen(bed, acme, fromOwner)).toBe(true);
    expect(await isOpen(bed, acme, fromAdmin)).toBe(false);
    expect(bed.securityEvents.events.at(-1)).toMatchObject({
      targetUserId: 'adm',
      revokedInvitations: 1,
    });
  });

  it('treats the same role as a no-op: no write, no event', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'member'],
    ]);

    const view = await new ChangeMemberRoleUseCase(bed).execute(as('ana', acme, 'owner'), {
      userId: 'bia',
      role: 'member',
      version: 1,
    });

    expect(view.version).toBe(1);
    expect(bed.securityEvents.events).toEqual([]);
  });
});

describe('RemoveMemberUseCase (RF-11, RF-12)', () => {
  it('CA-09: an admin removes a member, who loses access on the next request', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['adm', 'admin'],
      ['bia', 'member'],
    ]);
    const pending = await inviteFrom(bed, acme, 'bia', 'z@exemplo.com');

    await new RemoveMemberUseCase(bed).execute(as('adm', acme, 'admin'), {
      userId: 'bia',
      version: 1,
    });

    expect(
      await new ResolveTenantMembershipUseCase(bed).execute({
        userId: 'bia',
        organizationId: acme,
      }),
    ).toBeNull();
    expect(await isOpen(bed, acme, pending)).toBe(false);
    expect(bed.organizations.locks).toEqual([acme]);
    expect(bed.securityEvents.events).toEqual([
      {
        type: 'organizations.member_removed',
        requestId: 'req-1',
        organizationId: acme,
        actorUserId: 'adm',
        targetUserId: 'bia',
        role: 'member',
        revokedInvitations: 1,
      },
    ]);
  });

  it('CA-07: an admin cannot remove an owner; a member cannot remove anyone', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['eva', 'owner'],
      ['adm', 'admin'],
      ['bia', 'member'],
    ]);
    const remove = new RemoveMemberUseCase(bed);

    await expect(
      remove.execute(as('adm', acme, 'admin'), { userId: 'ana', version: 1 }),
    ).rejects.toBeInstanceOf(InsufficientRoleError);
    const locksBefore = bed.organizations.locks.length;
    await expect(
      remove.execute(as('bia', acme, 'member'), { userId: 'adm', version: 1 }),
    ).rejects.toBeInstanceOf(InsufficientRoleError);
    // Negação rápida: quem não gerencia membros nem chega a travar a organização.
    expect(bed.organizations.locks).toHaveLength(locksBefore);
    expect(bed.memberships.rows.size).toBe(4);
  });

  it('decides a removal on the actor role re-read under the lock', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['adm', 'viewer'],
      ['bia', 'member'],
    ]);

    // O middleware ainda viu "admin", mas `adm` foi rebaixado antes da transação.
    await expect(
      new RemoveMemberUseCase(bed).execute(as('adm', acme, 'admin'), { userId: 'bia', version: 1 }),
    ).rejects.toBeInstanceOf(InsufficientRoleError);
    expect(await roleOf(bed, acme, 'bia')).toBe('member');
  });

  it('CA-08: removing the only owner answers LAST_OWNER, whoever asks', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['adm', 'admin'],
    ]);

    await expect(
      new RemoveMemberUseCase(bed).execute(as('adm', acme, 'admin'), { userId: 'ana', version: 1 }),
    ).rejects.toBeInstanceOf(LastOwnerError);
    expect(bed.memberships.rows.size).toBe(2);
  });

  it('RF-12 / CA-08: any member leaves, except the last owner', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'viewer'],
    ]);
    const remove = new RemoveMemberUseCase(bed);

    await remove.execute(as('bia', acme, 'viewer'), { userId: 'bia', version: 1 });
    await expect(
      remove.execute(as('ana', acme, 'owner'), { userId: 'ana', version: 1 }),
    ).rejects.toBeInstanceOf(LastOwnerError);

    expect(bed.securityEvents.types()).toEqual(['organizations.member_left']);
    expect(await roleOf(bed, acme, 'ana')).toBe('owner');
  });

  it('CA-08: the owner may remove another owner while one remains', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'owner'],
    ]);

    await new RemoveMemberUseCase(bed).execute(as('ana', acme, 'owner'), {
      userId: 'bia',
      version: 1,
    });

    expect(await bed.memberships.countOwners(acme)).toBe(1);
  });

  it('BR-008, 404 and a removed actor', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['adm', 'admin'],
      ['bia', 'member'],
    ]);
    const remove = new RemoveMemberUseCase(bed);

    await expect(
      remove.execute(as('ana', acme, 'owner'), { userId: 'bia', version: 2 }),
    ).rejects.toBeInstanceOf(VersionConflictError);
    await expect(
      remove.execute(as('ana', acme, 'owner'), { userId: 'ghost', version: 1 }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
    await bed.memberships.remove(acme, 'adm', 1);
    await expect(
      remove.execute(as('adm', acme, 'admin'), { userId: 'bia', version: 1 }),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError);
    expect(await roleOf(bed, acme, 'bia')).toBe('member');
  });
});
