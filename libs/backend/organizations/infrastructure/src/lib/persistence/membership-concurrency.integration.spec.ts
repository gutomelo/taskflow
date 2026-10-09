import { randomUUID } from 'node:crypto';
import type { OrganizationRole, TenantRequestContext } from '@taskflow/backend/shared/application';
import { FixedClock } from '@taskflow/backend/shared/application/testing';
import {
  createPrismaClient,
  PrismaTransactionRunner,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import {
  LastOwnerError,
  Membership,
  RoleChangeNotAllowedError,
  Organization,
  OrganizationName,
  OrganizationSlug,
} from '@taskflow/backend/organizations/domain';
import {
  ChangeMemberRoleUseCase,
  InsufficientRoleError,
  RemoveMemberUseCase,
} from '@taskflow/backend/organizations/application';
import {
  InMemoryUserDirectory,
  RecordingOrganizationsSecurityEvents,
} from '@taskflow/backend/organizations/application/testing';
import { PrismaInvitationRepository } from './prisma-invitation.repository';
import { PrismaMembershipRepository } from './prisma-membership.repository';
import { PrismaOrganizationRepository } from './prisma-organization.repository';

/** Promessa com o `resolve` exposto (equivalente a `Promise.withResolvers`, fora da lib ES2022). */
function signal() {
  const box: { resolve: () => void } = { resolve: () => undefined };
  const promise = new Promise<void>((resolve) => {
    box.resolve = resolve;
  });
  return { promise, resolve: () => box.resolve() };
}

/** Espera os `parties` chegarem ou o prazo acabar — com o lock, o segundo nunca chega. */
function barrier(parties: number, timeoutMs: number) {
  let arrived = 0;
  const opened = signal();
  setTimeout(opened.resolve, timeoutMs);
  return async () => {
    arrived += 1;
    if (arrived >= parties) opened.resolve();
    await opened.promise;
  };
}

describe('membership changes under concurrency (integration, T10)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let organizations: PrismaOrganizationRepository;
  let memberships: PrismaMembershipRepository;
  let invitations: PrismaInvitationRepository;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma);
    organizations = new PrismaOrganizationRepository(transactions);
    memberships = new PrismaMembershipRepository(transactions);
    invitations = new PrismaInvitationRepository(transactions);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.$executeRaw`TRUNCATE organizations CASCADE`;
  });

  function dependencies() {
    return {
      organizations,
      memberships,
      invitations,
      transactions,
      users: new InMemoryUserDirectory(),
      securityEvents: new RecordingOrganizationsSecurityEvents(),
      clock: new FixedClock(new Date()),
    };
  }

  async function seed(members: ReadonlyArray<readonly [string, OrganizationRole]>) {
    const now = new Date();
    const organization = Organization.create({
      id: randomUUID(),
      name: OrganizationName.create('Acme'),
      slug: OrganizationSlug.create(`org-${randomUUID().slice(0, 8)}`),
      now,
    });
    await organizations.add(organization);
    for (const [userId, role] of members) {
      await memberships.add(
        Membership.create({ id: randomUUID(), organizationId: organization.id, userId, role, now }),
      );
    }
    return organization.id;
  }

  function as(
    userId: string,
    organizationId: string,
    role: OrganizationRole,
  ): TenantRequestContext {
    return {
      requestId: randomUUID(),
      actor: { userId, sessionId: randomUUID() },
      tenant: { organizationId, organizationRole: role },
    };
  }

  it('CA-08 / RNF-05: two owners demoting each other never leave the organization without an owner', async () => {
    const [ana, bia] = [randomUUID(), randomUUID()];
    const organizationId = await seed([
      [ana, 'owner'],
      [bia, 'owner'],
    ]);
    // Sem o lock, as duas transações leriam "2 owners" aqui e ambas rebaixariam.
    const bothCounted = barrier(2, 400);
    const countOwners = memberships.countOwners.bind(memberships);
    vi.spyOn(memberships, 'countOwners').mockImplementation(async (id) => {
      const count = await countOwners(id);
      await bothCounted();
      return count;
    });
    const change = new ChangeMemberRoleUseCase(dependencies());

    const results = await Promise.allSettled([
      change.execute(as(ana, organizationId, 'owner'), { userId: bia, role: 'admin', version: 1 }),
      change.execute(as(bia, organizationId, 'owner'), { userId: ana, role: 'admin', version: 1 }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(LastOwnerError);
    expect(await prisma.membership.count({ where: { organizationId, role: 'owner' } })).toBe(1);
  });

  it('CA-08: removing and leaving at once still keeps one owner', async () => {
    const [ana, bia] = [randomUUID(), randomUUID()];
    const organizationId = await seed([
      [ana, 'owner'],
      [bia, 'owner'],
    ]);
    const bothCounted = barrier(2, 400);
    const countOwners = memberships.countOwners.bind(memberships);
    vi.spyOn(memberships, 'countOwners').mockImplementation(async (id) => {
      const count = await countOwners(id);
      await bothCounted();
      return count;
    });
    const remove = new RemoveMemberUseCase(dependencies());

    const results = await Promise.allSettled([
      remove.execute(as(ana, organizationId, 'owner'), { userId: ana, version: 1 }),
      remove.execute(as(bia, organizationId, 'owner'), { userId: bia, version: 1 }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await prisma.membership.count({ where: { organizationId, role: 'owner' } })).toBe(1);
  });

  it('an admin demoted while its removal waits for the lock cannot complete it', async () => {
    const [owner, admin, target] = [randomUUID(), randomUUID(), randomUUID()];
    const organizationId = await seed([
      [owner, 'owner'],
      [admin, 'admin'],
      [target, 'member'],
    ]);
    // O owner rebaixa o admin e segura o lock um pouco antes do commit.
    const saved = signal();
    const save = memberships.save.bind(memberships);
    vi.spyOn(memberships, 'save').mockImplementation(async (membership) => {
      await save(membership);
      saved.resolve();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const deps = dependencies();

    const demotion = new ChangeMemberRoleUseCase(deps).execute(as(owner, organizationId, 'owner'), {
      userId: admin,
      role: 'member',
      version: 1,
    });
    await saved.promise;
    // O middleware desta requisição ainda viu "admin" (negação rápida passa).
    const removal = new RemoveMemberUseCase(deps).execute(as(admin, organizationId, 'admin'), {
      userId: target,
      version: 1,
    });

    await expect(demotion).resolves.toMatchObject({ role: 'member' });
    await expect(removal).rejects.toBeInstanceOf(InsufficientRoleError);
    expect(
      await prisma.membership.findFirst({ where: { organizationId, userId: target } }),
    ).not.toBeNull();
  });

  it('an admin demoted while its role change waits for the lock cannot promote anyone', async () => {
    const [owner, admin, target] = [randomUUID(), randomUUID(), randomUUID()];
    const organizationId = await seed([
      [owner, 'owner'],
      [admin, 'admin'],
      [target, 'viewer'],
    ]);
    const saved = signal();
    const save = memberships.save.bind(memberships);
    const spy = vi.spyOn(memberships, 'save').mockImplementation(async (membership) => {
      await save(membership);
      if (membership.userId !== admin) return;
      saved.resolve();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const deps = dependencies();

    const demotion = new ChangeMemberRoleUseCase(deps).execute(as(owner, organizationId, 'owner'), {
      userId: admin,
      role: 'viewer',
      version: 1,
    });
    await saved.promise;
    const promotion = new ChangeMemberRoleUseCase(deps).execute(
      as(admin, organizationId, 'admin'),
      {
        userId: target,
        role: 'admin',
        version: 1,
      },
    );

    await expect(demotion).resolves.toMatchObject({ role: 'viewer' });
    await expect(promotion).rejects.toBeInstanceOf(RoleChangeNotAllowedError);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(
      (await prisma.membership.findFirst({ where: { organizationId, userId: target } }))?.role,
    ).toBe('viewer');
  });
});
