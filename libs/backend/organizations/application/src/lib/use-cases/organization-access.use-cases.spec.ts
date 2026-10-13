import type { OrganizationRole } from '@taskflow/backend/shared/kernel';
import {
  Membership,
  Organization,
  OrganizationName,
  OrganizationSlug,
} from '@taskflow/backend/organizations/domain';
import {
  createOrganizationsTestbed,
  type OrganizationsTestbed,
} from '../../testing/organizations-fakes';
import {
  GetMemberRolesUseCase,
  ListMembersExcludingUseCase,
  LockOrganizationForShareUseCase,
} from './organization-access.use-cases';

async function seed(
  bed: OrganizationsTestbed,
  members: ReadonlyArray<readonly [string, OrganizationRole]>,
) {
  const now = bed.clock.now();
  const organization = Organization.create({
    id: bed.idGenerator.generate(),
    name: OrganizationName.create('Acme'),
    slug: OrganizationSlug.create('acme'),
    now,
  });
  await bed.organizations.add(organization);
  for (const [userId, role] of members) {
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
  return organization;
}

describe('organization access for projects (spec 003, port OrganizationAccess)', () => {
  it('locks the organization for share and rereads settings and roles of members only', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'viewer'],
    ]);
    acme.updateSettings({ membersCanCreateProjects: false }, bed.clock.now());
    await bed.organizations.save(acme);

    const access = await new LockOrganizationForShareUseCase(bed).execute(acme.id, [
      'ana',
      'bia',
      'zeca',
    ]);

    expect(bed.organizations.shareLocks).toEqual([acme.id]);
    expect(access).toEqual({
      membersCanCreateProjects: false,
      roles: new Map([
        ['ana', 'owner'],
        ['bia', 'viewer'],
      ]),
    });
  });

  it('answers null for an organization that no longer exists', async () => {
    const bed = createOrganizationsTestbed();

    expect(await new LockOrganizationForShareUseCase(bed).execute('gone', ['ana'])).toBeNull();
  });

  it('reads current roles without locking', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [['ana', 'admin']]);

    expect(await new GetMemberRolesUseCase(bed).execute(acme.id, ['ana', 'zeca'])).toEqual(
      new Map([['ana', 'admin']]),
    );
    expect(bed.organizations.shareLocks).toEqual([]);
  });

  it('pages members with the given roles except the given users (project candidates)', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seed(bed, [
      ['ana', 'owner'],
      ['bia', 'member'],
      ['caio', 'viewer'],
      ['davi', 'member'],
      ['adm', 'admin'],
    ]);
    const list = new ListMembersExcludingUseCase(bed);

    const filter = { excludeUserIds: ['bia'], roles: ['member', 'viewer'] as const };
    const page = await list.execute(acme.id, filter, { limit: 2 });

    // Owner e admin ficam de fora pelo papel; bia, pela exclusão — a página vem cheia.
    expect(page).toEqual({
      items: [
        { userId: 'caio', role: 'viewer' },
        { userId: 'davi', role: 'member' },
      ],
      nextCursor: null,
    });
  });
});
