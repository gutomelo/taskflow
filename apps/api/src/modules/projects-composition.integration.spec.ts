import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { pino } from 'pino';
import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import {
  fakePseudonymizer,
  FixedClock,
  InMemoryRateLimiter,
} from '@taskflow/backend/shared/application/testing';
import { createCsrfProtection } from '@taskflow/backend/shared/http';
import {
  createPrismaClient,
  PrismaOutboxWriter,
  PrismaTransactionRunner,
  TransactionRequiredError,
  UuidV7Generator,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';
import {
  ChangeMemberRoleUseCase,
  RemoveMemberUseCase,
  UpdateOrganizationUseCase,
} from '@taskflow/backend/organizations/application';
import {
  InMemoryUserDirectory,
  RecordingOrganizationsSecurityEvents,
} from '@taskflow/backend/organizations/application/testing';
import {
  PrismaInvitationRepository,
  PrismaMembershipRepository,
  PrismaOrganizationRepository,
} from '@taskflow/backend/organizations/infrastructure';
import { InsufficientRoleError } from '@taskflow/backend/projects/application';
import { InMemoryProjectsUserDirectory } from '@taskflow/backend/projects/application/testing';
import { ProjectRoleAboveCeilingError } from '@taskflow/backend/projects/domain';
import { VersionConflictError } from '@taskflow/backend/shared/kernel';
import { createMembershipRoleChanges } from './adapters/membership-role-changes.adapter';
import { createWorkflowStatusUsage } from './adapters/workflow-status-usage.adapter';
import { createContributorChanges } from './adapters/contributor-changes.adapter';
import { createOrganizationAccess } from './adapters/organization-access.adapter';
import { createOrganizationsModule } from './organizations.module';
import { createProjectsFoundation, createProjectsModule } from './projects.module';
import { createTasksFoundation } from './tasks.module';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ponto de pausa: quem chega espera `release()`; o teste espera `reached`. */
function pausePoint() {
  let release: () => void = () => undefined;
  let reach: () => void = () => undefined;
  const released = new Promise<void>((resolve) => (release = resolve));
  const reached = new Promise<void>((resolve) => (reach = resolve));
  return { release, reached, wait: async () => (reach(), released) };
}

/**
 * Spec 003, T7: a composição real (mesma ordem e adaptadores de `main.ts`, uma instância do
 * runner) com PostgreSQL. Prova BR-027 entre contextos e a serialização papéis × projetos.
 */
describe('projects composition (integration, spec 003 T7)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let projects: ReturnType<typeof createProjectsModule>;
  let organizationAccess: ReturnType<typeof createOrganizationAccess>;
  let orgRepositories: {
    organizations: PrismaOrganizationRepository;
    memberships: PrismaMembershipRepository;
    invitations: PrismaInvitationRepository;
  };
  let membershipRoleChanges: ReturnType<typeof createMembershipRoleChanges>;
  let foundation: ReturnType<typeof createProjectsFoundation>;
  const clock = new FixedClock(new Date());

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma, { timeoutMs: 15_000 });
    const idGenerator = new UuidV7Generator();
    const rateLimiter = new InMemoryRateLimiter();
    const logger = pino({ level: 'silent' });
    // Mesma ordem de montagem de `main.ts`.
    const tasksFoundationForProjects = createTasksFoundation({ transactions, clock });
    foundation = createProjectsFoundation({
      transactions,
      clock,
      contributorChanges: createContributorChanges(tasksFoundationForProjects),
      workflowStatusUsage: createWorkflowStatusUsage(tasksFoundationForProjects),
    });
    membershipRoleChanges = createMembershipRoleChanges(foundation);
    const noop: RequestHandler = (_request, _response, next) => next();
    const organizations = createOrganizationsModule({
      logger,
      transactions,
      outbox: new PrismaOutboxWriter(transactions),
      rateLimiter,
      pseudonymizer: fakePseudonymizer,
      idGenerator,
      clock,
      users: new InMemoryUserDirectory(),
      authenticate: noop,
      csrf: createCsrfProtection({
        appOrigin: 'http://localhost',
        secret: 's'.repeat(43),
        secureCookie: true,
      }),
      membershipRoleChanges,
    });
    organizationAccess = createOrganizationAccess(organizations);
    projects = createProjectsModule({
      foundation,
      logger,
      transactions,
      rateLimiter,
      idGenerator,
      clock,
      organizationAccess,
      users: new InMemoryProjectsUserDirectory(),
    });
    orgRepositories = {
      organizations: new PrismaOrganizationRepository(transactions),
      memberships: new PrismaMembershipRepository(transactions),
      invitations: new PrismaInvitationRepository(transactions),
    };
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE organizations CASCADE`;
  });

  /** Casos de uso de `organizations` com a porta real (como `createOrganizationsModule`). */
  function organizationUseCases(repositories = orgRepositories) {
    const deps = {
      ...repositories,
      transactions,
      users: new InMemoryUserDirectory(),
      securityEvents: new RecordingOrganizationsSecurityEvents(),
      membershipRoleChanges,
      clock,
    };
    return {
      changeRole: new ChangeMemberRoleUseCase(deps),
      remove: new RemoveMemberUseCase(deps),
      update: new UpdateOrganizationUseCase(deps),
    };
  }

  async function organization(members: Record<string, OrganizationRole>) {
    const id = randomUUID();
    await prisma.organization.create({
      data: { id, name: 'Acme', slug: `org-${id.slice(0, 8)}`, createdAt: new Date() },
    });
    for (const [userId, role] of Object.entries(members)) await membership(id, userId, role);
    return id;
  }

  function membership(organizationId: string, userId: string, role: OrganizationRole) {
    return prisma.membership.create({
      data: { id: randomUUID(), organizationId, userId, role, createdAt: new Date() },
    });
  }

  function as(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ): TenantRequestContext {
    return {
      requestId: 'req-1',
      actor: { userId, sessionId: `s-${userId}` },
      tenant: { organizationId, organizationRole: role },
    };
  }

  async function participation(organizationId: string, projectId: string, userId: string) {
    return prisma.projectMember.findUnique({
      where: { organizationId_projectId_userId: { organizationId, projectId, userId } },
      select: { role: true, version: true },
    });
  }

  async function membershipVersion(organizationId: string, userId: string) {
    const row = await prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { version: true },
    });
    if (!row) throw new Error('membership not found');
    return row.version;
  }

  /** Org com ana (owner), mia (member, cria P1 e P2) e eva (member, manager em P1 e P2). */
  async function world() {
    const [ana, mia, eva] = [randomUUID(), randomUUID(), randomUUID()];
    const organizationId = await organization({ [ana]: 'owner', [mia]: 'member', [eva]: 'member' });
    const create = projects.useCases.createProject;
    const p1 = await create.execute(as(organizationId, mia, 'member'), {
      key: 'WEB',
      name: 'Website',
    });
    const p2 = await create.execute(as(organizationId, mia, 'member'), {
      key: 'APP',
      name: 'Aplicativo',
    });
    for (const projectId of [p1.id, p2.id]) {
      await projects.useCases.addMember.execute(as(organizationId, mia, 'member'), {
        projectId,
        userId: eva,
        role: 'manager',
      });
    }
    return { organizationId, ana, mia, eva, p1: p1.id, p2: p2.id };
  }

  it('fails closed: the organization access port refuses to lock outside a transaction', async () => {
    await expect(organizationAccess.lockForShare(randomUUID(), [])).rejects.toBeInstanceOf(
      TransactionRequiredError,
    );
  });

  it('BR-027: demoting to viewer caps participations in the same transaction; promoting back never restores', async () => {
    const { organizationId, ana, eva, p1, p2 } = await world();
    const { changeRole } = organizationUseCases();

    await changeRole.execute(as(organizationId, ana, 'owner'), {
      userId: eva,
      role: 'viewer',
      version: 1,
    });
    expect(await participation(organizationId, p1, eva)).toEqual({ role: 'viewer', version: 2 });
    expect(await participation(organizationId, p2, eva)).toEqual({ role: 'viewer', version: 2 });

    await changeRole.execute(as(organizationId, ana, 'owner'), {
      userId: eva,
      role: 'member',
      version: 2,
    });
    expect(await participation(organizationId, p1, eva)).toEqual({ role: 'viewer', version: 2 });
  });

  it('BR-027: removing someone from the organization deletes their participations; rejoining restores none', async () => {
    const { organizationId, ana, eva, p1, p2 } = await world();

    await organizationUseCases().remove.execute(as(organizationId, ana, 'owner'), {
      userId: eva,
      version: await membershipVersion(organizationId, eva),
    });
    await membership(organizationId, eva, 'member');

    expect(await participation(organizationId, p1, eva)).toBeNull();
    expect(await participation(organizationId, p2, eva)).toBeNull();
  });

  it('CA-08: a project promotion holding the share lock goes first; the demotion then caps it', async () => {
    const { organizationId, ana, mia, eva, p1 } = await world();
    await projects.useCases.changeMemberRole.execute(as(organizationId, mia, 'member'), {
      projectId: p1,
      userId: eva,
      role: 'member',
      version: 1,
    });
    const pause = pausePoint();
    const lockForUpdate = foundation.projects.lockForUpdate.bind(foundation.projects);
    const spy = vi
      .spyOn(foundation.projects, 'lockForUpdate')
      .mockImplementationOnce(async (organization, project) => {
        const locked = await lockForUpdate(organization, project);
        await pause.wait();
        return locked;
      });

    const promotion = projects.useCases.changeMemberRole.execute(
      as(organizationId, mia, 'member'),
      {
        projectId: p1,
        userId: eva,
        role: 'manager',
        version: 2,
      },
    );
    await pause.reached;
    const demotion = organizationUseCases().changeRole.execute(as(organizationId, ana, 'owner'), {
      userId: eva,
      role: 'viewer',
      version: 1,
    });
    await sleep(300);
    pause.release();
    await Promise.all([promotion, demotion]);
    spy.mockRestore();

    expect(await participation(organizationId, p1, eva)).toEqual({ role: 'viewer', version: 4 });
  });

  it('CA-08: a demotion holding the organization lock goes first; the promotion then hits the ceiling', async () => {
    const { organizationId, ana, mia, eva, p1 } = await world();
    const pausedRepositories = {
      ...orgRepositories,
      memberships: new PrismaMembershipRepository(transactions),
    };
    const pause = pausePoint();
    const save = pausedRepositories.memberships.save.bind(pausedRepositories.memberships);
    vi.spyOn(pausedRepositories.memberships, 'save').mockImplementationOnce(async (member) => {
      await save(member);
      await pause.wait();
    });

    const demotion = organizationUseCases(pausedRepositories).changeRole.execute(
      as(organizationId, ana, 'owner'),
      { userId: eva, role: 'viewer', version: 1 },
    );
    await pause.reached;
    const promotion = projects.useCases.changeMemberRole.execute(
      as(organizationId, mia, 'member'),
      {
        projectId: p1,
        userId: eva,
        role: 'manager' satisfies ProjectRole,
        version: 1,
      },
    );
    await sleep(300);
    pause.release();

    await expect(demotion).resolves.toBeDefined();
    // Releu tudo depois do commit do rebaixamento: a participação já foi rebaixada e teve a
    // versão incrementada (BR-027), então a promoção com a versão antiga recebe 409.
    await expect(promotion).rejects.toBeInstanceOf(VersionConflictError);
    // Mesmo com a versão atual, o teto barra a promoção.
    await expect(
      projects.useCases.changeMemberRole.execute(as(organizationId, mia, 'member'), {
        projectId: p1,
        userId: eva,
        role: 'manager',
        version: 2,
      }),
    ).rejects.toBeInstanceOf(ProjectRoleAboveCeilingError);
    expect(await participation(organizationId, p1, eva)).toEqual({ role: 'viewer', version: 2 });
  });

  it('BR-024: a member creating while the setting is being switched off waits and then is refused', async () => {
    const { organizationId, ana, mia } = await world();
    const pausedRepositories = {
      ...orgRepositories,
      organizations: new PrismaOrganizationRepository(transactions),
    };
    const pause = pausePoint();
    const save = pausedRepositories.organizations.save.bind(pausedRepositories.organizations);
    vi.spyOn(pausedRepositories.organizations, 'save').mockImplementationOnce(
      async (organization) => {
        await save(organization);
        await pause.wait();
      },
    );

    const switchOff = organizationUseCases(pausedRepositories).update.execute(
      as(organizationId, ana, 'owner'),
      { membersCanCreateProjects: false, version: 1 },
    );
    await pause.reached;
    const creation = projects.useCases.createProject.execute(as(organizationId, mia, 'member'), {
      key: 'NEW',
      name: 'Novo',
    });
    await sleep(300);
    pause.release();

    await switchOff;
    await expect(creation).rejects.toBeInstanceOf(InsufficientRoleError);
    expect(await prisma.project.count({ where: { organizationId, key: 'NEW' } })).toBe(0);
  });

  it('another connection holding the membership lock delays adding a participant until its commit', async () => {
    const { organizationId, mia, p1 } = await world();
    const bia = randomUUID();
    await membership(organizationId, bia, 'member');
    const order: string[] = [];
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));

    const holder = prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR NO KEY UPDATE`;
        locked();
        await sleep(400);
        order.push('membership lock released');
      },
      { timeout: 10_000 },
    );
    await isLocked;
    await projects.useCases.addMember.execute(as(organizationId, mia, 'member'), {
      projectId: p1,
      userId: bia,
      role: 'member',
    });
    order.push('participant added');
    await holder;

    expect(order).toEqual(['membership lock released', 'participant added']);
  });

  it('BR-008: two edits with the same version — exactly one wins', async () => {
    const { organizationId, mia, p1 } = await world();
    const edit = (description: string) =>
      projects.useCases.updateProject.execute(as(organizationId, mia, 'member'), {
        projectId: p1,
        description,
        version: 1,
      });

    const results = await Promise.allSettled([edit('A'), edit('B')]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(VersionConflictError);
  });
});
