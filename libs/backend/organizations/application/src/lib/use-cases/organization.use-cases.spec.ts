import {
  RateLimitedError,
  type OrganizationRole,
  type RequestContext,
  type TenantRequestContext,
} from '@taskflow/backend/shared/application';
import { VersionConflictError } from '@taskflow/backend/shared/kernel';
import {
  InvalidOrganizationNameError,
  InvalidSlugError,
  Membership,
  Organization,
  OrganizationName,
  OrganizationSlug,
  SlugTakenError,
} from '@taskflow/backend/organizations/domain';
import {
  createOrganizationsTestbed,
  type OrganizationsTestbed,
} from '../../testing/organizations-fakes';
import {
  MAX_MEMBERSHIPS_PER_USER,
  MAX_OWNED_ORGANIZATIONS,
  ORGANIZATION_CREATION_POLICY,
} from '../shared/organization-limits';
import {
  EmailNotVerifiedError,
  InsufficientRoleError,
  OrganizationLimitReachedError,
  OrganizationNotFoundError,
} from '../shared/organizations-errors';
import { CreateOrganizationUseCase } from './create-organization.use-case';
import { GetOrganizationUseCase } from './get-organization.use-case';
import { ListMyOrganizationsUseCase } from './list-my-organizations.use-case';
import { RenameOrganizationUseCase } from './rename-organization.use-case';
import { ResolveTenantMembershipUseCase } from './resolve-tenant-membership.use-case';

const ANA = 'u-ana';
const BRUNO = 'u-bruno';

function contextFor(userId: string): RequestContext {
  return { requestId: 'req-1', actor: { userId, sessionId: `s-${userId}` } };
}

function tenantContextFor(
  userId: string,
  organizationId: string,
  organizationRole: OrganizationRole,
): TenantRequestContext {
  return { ...contextFor(userId), tenant: { organizationId, organizationRole } };
}

function addAccount(bed: OrganizationsTestbed, id: string, emailVerified = true) {
  bed.users.add({ id, name: id, email: `${id}@exemplo.com`, emailVerified });
}

/** Organização gravada direto nos fakes (sem passar pelo limite de criação). */
async function seedOrganization(
  bed: OrganizationsTestbed,
  slug: string,
  members: ReadonlyArray<readonly [string, OrganizationRole]>,
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

describe('CreateOrganizationUseCase (RF-01)', () => {
  it('CA-01: a verified user creates the organization and becomes its owner', async () => {
    const bed = createOrganizationsTestbed();
    addAccount(bed, ANA);

    const view = await new CreateOrganizationUseCase(bed).execute(contextFor(ANA), {
      name: '  Acme Ltda ',
      slug: 'acme',
    });

    expect(view).toEqual({
      id: expect.any(String),
      name: 'Acme Ltda',
      slug: 'acme',
      version: 1,
      createdAt: bed.clock.now(),
      myRole: 'owner',
    });
    expect((await bed.memberships.find(view.id, ANA))?.toSnapshot().role).toBe('owner');
    expect(bed.securityEvents.events).toEqual([
      {
        type: 'organizations.created',
        requestId: 'req-1',
        organizationId: view.id,
        actorUserId: ANA,
      },
    ]);
  });

  it('CA-01 / BR-013: refuses an unverified or unknown account, persisting nothing', async () => {
    const bed = createOrganizationsTestbed();
    addAccount(bed, ANA, false);
    const create = new CreateOrganizationUseCase(bed);

    await expect(
      create.execute(contextFor(ANA), { name: 'Acme', slug: 'acme' }),
    ).rejects.toBeInstanceOf(EmailNotVerifiedError);
    await expect(
      create.execute(contextFor('ghost'), { name: 'Acme', slug: 'acme' }),
    ).rejects.toBeInstanceOf(EmailNotVerifiedError);
    expect(bed.organizations.rows.size).toBe(0);
    expect(bed.memberships.rows.size).toBe(0);
    expect(bed.securityEvents.events).toEqual([]);
  });

  it('CA-02 / BR-022: refuses invalid, reserved and taken slugs, rolling back the whole creation', async () => {
    const bed = createOrganizationsTestbed();
    addAccount(bed, ANA);
    addAccount(bed, BRUNO);
    const create = new CreateOrganizationUseCase(bed);
    await create.execute(contextFor(ANA), { name: 'Acme', slug: 'acme' });

    await expect(
      create.execute(contextFor(BRUNO), { name: 'X', slug: 'acme' }),
    ).rejects.toBeInstanceOf(InvalidOrganizationNameError);
    await expect(
      create.execute(contextFor(BRUNO), { name: 'Outra', slug: 'Acme' }),
    ).rejects.toBeInstanceOf(InvalidSlugError);
    await expect(
      create.execute(contextFor(BRUNO), { name: 'Outra', slug: 'taskflow' }),
    ).rejects.toBeInstanceOf(InvalidSlugError);
    await expect(
      create.execute(contextFor(BRUNO), { name: 'Outra', slug: 'acme' }),
    ).rejects.toBeInstanceOf(SlugTakenError);

    expect(bed.organizations.rows.size).toBe(1);
    expect(await bed.memberships.listForUser(BRUNO)).toEqual([]);
    expect(bed.transactions.rollbacks).toBe(1);
  });

  it('CA-12 / RNF-04: counts every attempt, including refused ones, against 5 per day', async () => {
    const bed = createOrganizationsTestbed();
    addAccount(bed, ANA);
    const create = new CreateOrganizationUseCase(bed);
    for (let attempt = 0; attempt < ORGANIZATION_CREATION_POLICY.points; attempt += 1) {
      await expect(
        create.execute(contextFor(ANA), { name: 'Acme', slug: 'admin' }),
      ).rejects.toBeInstanceOf(InvalidSlugError);
    }

    const blocked = create.execute(contextFor(ANA), { name: 'Acme', slug: 'acme' });

    await expect(blocked).rejects.toBeInstanceOf(RateLimitedError);
    await expect(blocked).rejects.toMatchObject({ retryAfterSeconds: 86_400 });
    expect(bed.organizations.rows.size).toBe(0);
    expect(bed.rateLimiter.keys()).toEqual([`${ORGANIZATION_CREATION_POLICY.name}|${ANA}`]);
  });

  it(`RNF-04: refuses a ${MAX_OWNED_ORGANIZATIONS + 1}st owned organization`, async () => {
    const bed = createOrganizationsTestbed();
    addAccount(bed, ANA);
    for (let index = 0; index < MAX_OWNED_ORGANIZATIONS - 1; index += 1) {
      await seedOrganization(bed, `org-${index}`, [[ANA, 'owner']]);
    }
    await seedOrganization(bed, 'outra', [[ANA, 'admin']]);
    const create = new CreateOrganizationUseCase(bed);
    await create.execute(contextFor(ANA), { name: 'Vigésima', slug: 'vigesima' });

    const refused = create.execute(contextFor(ANA), { name: 'Excesso', slug: 'excesso' });

    await expect(refused).rejects.toBeInstanceOf(OrganizationLimitReachedError);
    await expect(refused).rejects.toMatchObject({ limit: 'owned_organizations' });
  });

  it(`RNF-04: refuses creation at ${MAX_MEMBERSHIPS_PER_USER} memberships in any role`, async () => {
    const bed = createOrganizationsTestbed();
    addAccount(bed, ANA);
    for (let index = 0; index < MAX_MEMBERSHIPS_PER_USER; index += 1) {
      await seedOrganization(bed, `org-${index}`, [[ANA, 'viewer']]);
    }

    const refused = new CreateOrganizationUseCase(bed).execute(contextFor(ANA), {
      name: 'Excesso',
      slug: 'excesso',
    });

    await expect(refused).rejects.toMatchObject({ limit: 'memberships' });
  });
});

describe('ListMyOrganizationsUseCase (RF-02)', () => {
  it('lists only the actor organizations with the actor role, in one batch', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seedOrganization(bed, 'acme', [
      [ANA, 'owner'],
      [BRUNO, 'member'],
    ]);
    const beta = await seedOrganization(bed, 'beta', [[ANA, 'viewer']]);
    await seedOrganization(bed, 'gama', [[BRUNO, 'owner']]);

    const list = await new ListMyOrganizationsUseCase(bed).execute(contextFor(ANA));

    expect(list).toEqual([
      { id: acme, name: 'Org acme', slug: 'acme', role: 'owner' },
      { id: beta, name: 'Org beta', slug: 'beta', role: 'viewer' },
    ]);
    expect(bed.organizations.batches).toHaveLength(1);
  });

  it('returns an empty list without querying organizations', async () => {
    const bed = createOrganizationsTestbed();

    expect(await new ListMyOrganizationsUseCase(bed).execute(contextFor(ANA))).toEqual([]);
    expect(bed.organizations.batches).toEqual([]);
  });
});

describe('GetOrganizationUseCase', () => {
  it('returns the active organization with the role resolved for this request', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seedOrganization(bed, 'acme', [[ANA, 'member']]);

    const view = await new GetOrganizationUseCase(bed).execute(
      tenantContextFor(ANA, acme, 'member'),
    );

    expect(view).toMatchObject({ id: acme, slug: 'acme', myRole: 'member', version: 1 });
  });

  it('answers 404 for an organization that no longer exists', async () => {
    const bed = createOrganizationsTestbed();

    await expect(
      new GetOrganizationUseCase(bed).execute(tenantContextFor(ANA, 'gone', 'owner')),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError);
  });
});

describe('RenameOrganizationUseCase (RF-05)', () => {
  it.each<OrganizationRole>(['owner', 'admin'])(
    'lets the %s rename, keeping the slug (BR-022)',
    async (role) => {
      const bed = createOrganizationsTestbed();
      const acme = await seedOrganization(bed, 'acme', [[ANA, role]]);

      const view = await new RenameOrganizationUseCase(bed).execute(
        tenantContextFor(ANA, acme, role),
        {
          name: 'Acme Brasil',
          version: 1,
        },
      );

      expect(view).toMatchObject({ name: 'Acme Brasil', slug: 'acme', version: 2, myRole: role });
      expect(bed.organizations.rows.get(acme)).toMatchObject({ version: 2 });
      expect(bed.organizations.rows.get(acme)?.name.value).toBe('Acme Brasil');
    },
  );

  it.each<OrganizationRole>(['member', 'viewer'])(
    'forbids the %s, touching nothing',
    async (role) => {
      const bed = createOrganizationsTestbed();
      const acme = await seedOrganization(bed, 'acme', [[ANA, role]]);

      await expect(
        new RenameOrganizationUseCase(bed).execute(tenantContextFor(ANA, acme, role), {
          name: 'Tomada',
          version: 1,
        }),
      ).rejects.toBeInstanceOf(InsufficientRoleError);
      expect(bed.organizations.rows.get(acme)?.name.value).toBe('Org acme');
    },
  );

  it('BR-008: refuses a stale version and an invalid name', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seedOrganization(bed, 'acme', [[ANA, 'owner']]);
    const rename = new RenameOrganizationUseCase(bed);
    const context = tenantContextFor(ANA, acme, 'owner');
    await rename.execute(context, { name: 'Primeira', version: 1 });

    await expect(rename.execute(context, { name: 'Segunda', version: 1 })).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    await expect(rename.execute(context, { name: ' ', version: 2 })).rejects.toBeInstanceOf(
      InvalidOrganizationNameError,
    );
    expect(bed.organizations.rows.get(acme)).toMatchObject({ version: 2 });
  });
});

describe('ResolveTenantMembershipUseCase (RF-03)', () => {
  it('resolves the role of a member and nothing for anyone else', async () => {
    const bed = createOrganizationsTestbed();
    const acme = await seedOrganization(bed, 'acme', [[ANA, 'admin']]);
    const beta = await seedOrganization(bed, 'beta', [[BRUNO, 'owner']]);
    const resolve = new ResolveTenantMembershipUseCase(bed);

    expect(await resolve.execute({ userId: ANA, organizationId: acme })).toEqual({
      organizationId: acme,
      organizationRole: 'admin',
    });
    expect(await resolve.execute({ userId: ANA, organizationId: beta })).toBeNull();
    expect(await resolve.execute({ userId: ANA, organizationId: 'missing' })).toBeNull();
  });
});
