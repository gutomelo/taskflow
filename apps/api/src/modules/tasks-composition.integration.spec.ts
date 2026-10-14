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
  UuidV7Generator,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import {
  effectiveProjectRole,
  isOrganizationRole,
  type OrganizationRole,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import {
  ChangeMemberRoleUseCase,
  RemoveMemberUseCase,
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
import { InMemoryProjectsUserDirectory } from '@taskflow/backend/projects/application/testing';
import { InMemoryTaskUserDirectory } from '@taskflow/backend/tasks/application/testing';
import { createWorkflowStatusUsage } from './adapters/workflow-status-usage.adapter';
import { createContributorChanges } from './adapters/contributor-changes.adapter';
import { createMembershipRoleChanges } from './adapters/membership-role-changes.adapter';
import { createOrganizationAccess } from './adapters/organization-access.adapter';
import { createProjectAccess } from './adapters/project-access.adapter';
import { createOrganizationsModule } from './organizations.module';
import { createProjectsFoundation, createProjectsModule } from './projects.module';
import { createTasksFoundation, createTasksModule } from './tasks.module';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: { code?: string; message?: string }) => error.code ?? error.message ?? 'unknown',
  );

/**
 * Spec 004, T8: a composição real (mesma ordem e adaptadores de `main.ts`, uma instância do
 * runner) com PostgreSQL. Prova RNF-02 (BR-001, BR-003, BR-006, BR-028 sob concorrência), CA-05
 * (caminhos de RF-11) e CA-08 (arquivar × criar).
 */
describe('tasks composition (integration, spec 004 T8)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let projects: ReturnType<typeof createProjectsModule>;
  let tasks: ReturnType<typeof createTasksModule>;
  let membershipRoleChanges: ReturnType<typeof createMembershipRoleChanges>;
  let projectAccess: ReturnType<typeof createProjectAccess>;
  const clock = new FixedClock(new Date());

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma, { timeoutMs: 20_000 });
    const idGenerator = new UuidV7Generator();
    const rateLimiter = new InMemoryRateLimiter();
    const logger = pino({ level: 'silent' });
    // Mesma ordem de montagem de `main.ts` (design da spec 004).
    const tasksFoundation = createTasksFoundation({ transactions, clock });
    const projectsFoundation = createProjectsFoundation({
      transactions,
      clock,
      contributorChanges: createContributorChanges(tasksFoundation),
      workflowStatusUsage: createWorkflowStatusUsage(tasksFoundation),
    });
    membershipRoleChanges = createMembershipRoleChanges(projectsFoundation);
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
    projects = createProjectsModule({
      foundation: projectsFoundation,
      logger,
      transactions,
      rateLimiter,
      idGenerator,
      clock,
      organizationAccess: createOrganizationAccess(organizations),
      users: new InMemoryProjectsUserDirectory(),
    });
    projectAccess = createProjectAccess(projects);
    tasks = createTasksModule({
      foundation: tasksFoundation,
      logger,
      transactions,
      rateLimiter,
      idGenerator,
      clock,
      projectAccess,
      users: new InMemoryTaskUserDirectory(),
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE organizations CASCADE`;
  });

  afterEach(async () => {
    await expectBr003Invariant();
  });

  /** Verificador do invariante BR-003: todo responsável tem papel efetivo manager/member. */
  async function expectBr003Invariant() {
    const assigned = await prisma.task.findMany({
      where: { assigneeUserId: { not: null } },
      select: { organizationId: true, projectId: true, assigneeUserId: true, number: true },
    });
    const violations: string[] = [];
    for (const task of assigned) {
      const userId = task.assigneeUserId ?? '';
      const membership = await prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId: task.organizationId, userId } },
        select: { role: true },
      });
      const participation = await prisma.projectMember.findUnique({
        where: {
          organizationId_projectId_userId: {
            organizationId: task.organizationId,
            projectId: task.projectId,
            userId,
          },
        },
        select: { role: true },
      });
      const role =
        membership && isOrganizationRole(membership.role)
          ? effectiveProjectRole(membership.role, participation?.role ?? null)
          : null;
      if (role !== 'manager' && role !== 'member') violations.push(`#${task.number} → ${userId}`);
    }
    expect(violations).toEqual([]);
  }

  function organizationUseCases() {
    const deps = {
      organizations: new PrismaOrganizationRepository(transactions),
      memberships: new PrismaMembershipRepository(transactions),
      invitations: new PrismaInvitationRepository(transactions),
      transactions,
      users: new InMemoryUserDirectory(),
      securityEvents: new RecordingOrganizationsSecurityEvents(),
      membershipRoleChanges,
      clock,
    };
    return { changeRole: new ChangeMemberRoleUseCase(deps), remove: new RemoveMemberUseCase(deps) };
  }

  async function organization(members: Record<string, OrganizationRole>) {
    const id = randomUUID();
    await prisma.organization.create({
      data: { id, name: 'Acme', slug: `org-${id.slice(0, 8)}`, createdAt: new Date() },
    });
    for (const [userId, role] of Object.entries(members)) {
      await prisma.membership.create({
        data: { id: randomUUID(), organizationId: id, userId, role, createdAt: new Date() },
      });
    }
    return id;
  }

  const roles = new Map<string, OrganizationRole>();
  function as(organizationId: string, userId: string): TenantRequestContext {
    return {
      requestId: 'req-1',
      actor: { userId, sessionId: `s-${userId}` },
      tenant: {
        organizationId,
        organizationRole: roles.get(`${organizationId}|${userId}`) ?? 'member',
      },
    };
  }

  async function membershipVersion(organizationId: string, userId: string) {
    const row = await prisma.membership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId, userId } },
      select: { version: true },
    });
    return row.version;
  }

  async function participationVersion(organizationId: string, projectId: string, userId: string) {
    const row = await prisma.projectMember.findUniqueOrThrow({
      where: { organizationId_projectId_userId: { organizationId, projectId, userId } },
      select: { version: true },
    });
    return row.version;
  }

  async function changeOrgRole(
    organizationId: string,
    actor: string,
    userId: string,
    role: OrganizationRole,
  ) {
    await organizationUseCases().changeRole.execute(as(organizationId, actor), {
      userId,
      role,
      version: await membershipVersion(organizationId, userId),
    });
    roles.set(`${organizationId}|${userId}`, role);
  }

  const assigneeOf = async (taskId: string) =>
    (
      await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
        select: { assigneeUserId: true },
      })
    ).assigneeUserId;

  /** ana owner, adm admin; mia member (cria WEB e APP: manager); bia member (member em WEB e APP). */
  async function world() {
    const [ana, adm, mia, bia] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const people = { [ana]: 'owner', [adm]: 'admin', [mia]: 'member', [bia]: 'member' } as const;
    const organizationId = await organization(people);
    for (const [userId, role] of Object.entries(people))
      roles.set(`${organizationId}|${userId}`, role);
    const create = projects.useCases.createProject;
    const web = (await create.execute(as(organizationId, mia), { key: 'WEB', name: 'Website' })).id;
    const app = (await create.execute(as(organizationId, mia), { key: 'APP', name: 'App' })).id;
    for (const projectId of [web, app])
      await addMember(organizationId, mia, projectId, bia, 'member');
    const workflow = await prisma.workflowStatus.findMany({
      where: { organizationId, projectId: web },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    const [todo, doing, done] = workflow.map((status) => status.id);
    if (!todo || !doing || !done) throw new Error('default workflow missing');
    return { organizationId, ana, adm, mia, bia, web, app, status: { todo, doing, done } };
  }

  /** Admin com participações antigas: gravadas quando era member (D1 da 003), promovido depois. */
  async function formerMemberPromoted(
    organizationId: string,
    owner: string,
    manager: string,
    participations: ReadonlyArray<readonly [string, ProjectRole]>,
  ) {
    const userId = randomUUID();
    await prisma.membership.create({
      data: { id: randomUUID(), organizationId, userId, role: 'member', createdAt: new Date() },
    });
    roles.set(`${organizationId}|${userId}`, 'member');
    for (const [projectId, role] of participations) {
      await addMember(organizationId, manager, projectId, userId, role);
    }
    await changeOrgRole(organizationId, owner, userId, 'admin');
    return userId;
  }

  function addMember(
    organizationId: string,
    actor: string,
    projectId: string,
    userId: string,
    role: ProjectRole,
  ) {
    return projects.useCases.addMember.execute(as(organizationId, actor), {
      projectId,
      userId,
      role,
    });
  }

  function createTask(
    organizationId: string,
    actor: string,
    input: Parameters<typeof tasks.useCases.createTask.execute>[1],
  ) {
    return tasks.useCases.createTask.execute(as(organizationId, actor), input);
  }

  describe('RNF-02 under concurrency', () => {
    it('BR-028: twenty simultaneous creations get distinct numbers; deleted numbers are never reused', async () => {
      const { organizationId, mia, web } = await world();

      const created = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          createTask(organizationId, mia, { projectId: web, title: `T${index}` }),
        ),
      );
      const second = created.find((task) => task.number === 2);
      if (!second) throw new Error('WEB-2 missing');
      await tasks.useCases.deleteTask.execute(as(organizationId, mia), {
        taskId: second.id,
        version: 1,
      });
      const next = await createTask(organizationId, mia, { projectId: web, title: 'Depois' });

      expect(created.map((task) => task.number).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, index) => index + 1),
      );
      expect(next.key).toBe('WEB-21');
    });

    it('BR-006: A blocked by B and B blocked by A in parallel ⇒ exactly one DEPENDENCY_CYCLE', async () => {
      const { organizationId, mia, bia, web } = await world();
      const a = await createTask(organizationId, mia, { projectId: web, title: 'A' });
      const b = await createTask(organizationId, mia, { projectId: web, title: 'B' });
      const add = tasks.useCases.addDependency;

      const results = await Promise.all([
        outcome(add.execute(as(organizationId, mia), { taskId: a.id, blockingTaskId: b.id })),
        outcome(add.execute(as(organizationId, bia), { taskId: b.id, blockingTaskId: a.id })),
      ]);

      expect(results.sort()).toEqual(['DEPENDENCY_CYCLE', 'ok']);
      expect(await prisma.taskDependency.count()).toBe(1);
    });

    it('BR-001: completing the parent while a required subtask is created never leaves a completed parent with a pending one', async () => {
      const { organizationId, mia, bia, web, status } = await world();
      for (let round = 0; round < 5; round += 1) {
        const parent = await createTask(organizationId, mia, {
          projectId: web,
          title: `Pai ${round}`,
        });
        const doing = await tasks.useCases.transitionTask.execute(as(organizationId, mia), {
          taskId: parent.id,
          statusId: status.doing,
          version: 1,
        });

        const results = await Promise.all([
          outcome(
            tasks.useCases.transitionTask.execute(as(organizationId, mia), {
              taskId: parent.id,
              statusId: status.done,
              version: doing.version,
            }),
          ),
          outcome(
            createTask(organizationId, bia, {
              projectId: web,
              title: 'Obrigatória',
              parentTaskId: parent.id,
              isRequired: true,
            }),
          ),
        ]);

        // Uma das duas perde: ou a criação vê o pai concluído, ou a conclusão vê a pendência.
        expect(results.filter((result) => result === 'ok')).toHaveLength(1);
        expect(results.filter((result) => result !== 'ok')[0]).toMatch(
          /^(PARENT_TASK_COMPLETED|TASK_HAS_PENDING_REQUIRED_SUBTASKS)$/,
        );
      }
      const completedParents = await prisma.task.findMany({
        where: { organizationId, parentTaskId: null, completedAt: { not: null } },
        select: { id: true },
      });
      const pendingRequired = await prisma.task.count({
        where: {
          organizationId,
          parentTaskId: { in: completedParents.map((task) => task.id) },
          isRequired: true,
          completedAt: null,
          canceledAt: null,
        },
      });
      expect(pendingRequired).toBe(0);
    });

    it('BR-003: assigning while the person is demoted never leaves a reader as the assignee', async () => {
      const { organizationId, ana, mia, bia, web } = await world();
      const subjects = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          createTask(organizationId, mia, { projectId: web, title: `T${index}` }),
        ),
      );

      const results = await Promise.all([
        ...subjects.map((task) =>
          outcome(
            tasks.useCases.assignTask.execute(as(organizationId, mia), {
              taskId: task.id,
              assigneeUserId: bia,
              version: 1,
            }),
          ),
        ),
        outcome(changeOrgRole(organizationId, ana, bia, 'viewer')),
      ]);

      expect(results.at(-1)).toBe('ok');
      expect(
        results.slice(0, -1).every((result) => /^(ok|ASSIGNEE_NOT_PROJECT_MEMBER)$/.test(result)),
      ).toBe(true);
      for (const task of subjects) expect(await assigneeOf(task.id)).toBeNull();
    });

    it('CA-08: archiving waits for a creation holding the project lock, then creations are refused', async () => {
      const { organizationId, mia, web } = await world();
      const order: string[] = [];
      let release: () => void = () => undefined;
      let reached: () => void = () => undefined;
      const released = new Promise<void>((resolve) => (release = resolve));
      const isReached = new Promise<void>((resolve) => (reached = resolve));
      const lockForContribution = projectAccess.lockForContribution.bind(projectAccess);
      projectAccess.lockForContribution = async (...args) => {
        const locked = await lockForContribution(...args);
        reached();
        await released;
        return locked;
      };

      const creation = createTask(organizationId, mia, { projectId: web, title: 'Antes' }).then(
        () => order.push('created'),
      );
      await isReached;
      projectAccess.lockForContribution = lockForContribution;
      const archive = projects.useCases.archiveProject
        .execute(as(organizationId, mia), { projectId: web, version: 1 })
        .then(() => order.push('archived'));
      await sleep(300);
      order.push('released');
      release();
      await Promise.all([creation, archive]);

      expect(order).toEqual(['released', 'created', 'archived']);
      expect(
        await outcome(createTask(organizationId, mia, { projectId: web, title: 'Depois' })),
      ).toBe('PROJECT_ARCHIVED');
    });

    it('a revocation and a transition of the same task never end in an unrecovered deadlock', async () => {
      const { organizationId, mia, bia, web, status } = await world();
      for (let round = 0; round < 5; round += 1) {
        if (round > 0) await addMember(organizationId, mia, web, bia, 'member');
        const task = await createTask(organizationId, mia, {
          projectId: web,
          title: `T${round}`,
          assigneeUserId: bia,
        });

        const results = await Promise.all([
          outcome(
            tasks.useCases.transitionTask.execute(as(organizationId, bia), {
              taskId: task.id,
              statusId: status.doing,
              version: 1,
            }),
          ),
          outcome(
            projects.useCases.removeMember.execute(as(organizationId, mia), {
              projectId: web,
              userId: bia,
              version: await participationVersion(organizationId, web, bia),
            }),
          ),
        ]);

        expect(results[1]).toBe('ok');
        expect(results[0]).toMatch(/^(ok|VERSION_CONFLICT|TASK_NOT_FOUND)$/);
        expect(await assigneeOf(task.id)).toBeNull();
      }
    });
  });

  describe('CA-05: every RF-11 path undoes the assignments of that project only', () => {
    async function assignedWorld() {
      const base = await world();
      const { organizationId, mia, bia, web, app } = base;
      const inWeb = await createTask(organizationId, mia, {
        projectId: web,
        title: 'W',
        assigneeUserId: bia,
      });
      const inApp = await createTask(organizationId, mia, {
        projectId: app,
        title: 'A',
        assigneeUserId: bia,
      });
      return { ...base, inWeb: inWeb.id, inApp: inApp.id };
    }

    it('removed from the project, or leaving it', async () => {
      const { organizationId, mia, bia, web, app, inWeb, inApp } = await assignedWorld();

      await projects.useCases.removeMember.execute(as(organizationId, mia), {
        projectId: web,
        userId: bia,
        version: await participationVersion(organizationId, web, bia),
      });
      expect([await assigneeOf(inWeb), await assigneeOf(inApp)]).toEqual([null, bia]);

      await projects.useCases.removeMember.execute(as(organizationId, bia), {
        projectId: app,
        userId: bia,
        version: await participationVersion(organizationId, app, bia),
      });
      expect(await assigneeOf(inApp)).toBeNull();
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: inApp }, select: { version: true } }))
          .version,
      ).toBe(2);
    });

    it('participation changed to viewer (but not to manager)', async () => {
      const { organizationId, mia, bia, web, inWeb, inApp } = await assignedWorld();
      const change = (role: ProjectRole) =>
        participationVersion(organizationId, web, bia).then((version) =>
          projects.useCases.changeMemberRole.execute(as(organizationId, mia), {
            projectId: web,
            userId: bia,
            role,
            version,
          }),
        );

      await change('manager');
      expect(await assigneeOf(inWeb)).toBe(bia);
      await change('viewer');
      expect([await assigneeOf(inWeb), await assigneeOf(inApp)]).toEqual([null, bia]);
    });

    it('organization role changed to viewer undoes everything in the organization', async () => {
      const { organizationId, ana, bia, inWeb, inApp } = await assignedWorld();

      await changeOrgRole(organizationId, ana, bia, 'viewer');

      expect([await assigneeOf(inWeb), await assigneeOf(inApp)]).toEqual([null, null]);
    });

    it('an admin with an old viewer participation demoted to member loses that project only', async () => {
      const { organizationId, ana, mia, web, app } = await world();
      const adm = await formerMemberPromoted(organizationId, ana, mia, [
        [web, 'viewer'],
        [app, 'member'],
      ]);
      const inWeb = await createTask(organizationId, mia, {
        projectId: web,
        title: 'W',
        assigneeUserId: adm,
      });
      const inApp = await createTask(organizationId, mia, {
        projectId: app,
        title: 'A',
        assigneeUserId: adm,
      });

      await changeOrgRole(organizationId, ana, adm, 'member');

      expect([await assigneeOf(inWeb.id), await assigneeOf(inApp.id)]).toEqual([null, adm]);
    });

    it('an admin with an old participation leaving it keeps the assignments', async () => {
      const { organizationId, ana, mia, web } = await world();
      const adm = await formerMemberPromoted(organizationId, ana, mia, [[web, 'member']]);
      const task = await createTask(organizationId, mia, {
        projectId: web,
        title: 'W',
        assigneeUserId: adm,
      });

      await projects.useCases.removeMember.execute(as(organizationId, adm), {
        projectId: web,
        userId: adm,
        version: await participationVersion(organizationId, web, adm),
      });

      expect(await assigneeOf(task.id)).toBe(adm);
    });

    it('viewer → admin → member: assigned while admin, undone when back to member', async () => {
      const { organizationId, ana, mia, bia, web } = await world();
      await changeOrgRole(organizationId, ana, bia, 'viewer'); // participações limitadas a viewer
      await changeOrgRole(organizationId, ana, bia, 'admin');
      const task = await createTask(organizationId, mia, {
        projectId: web,
        title: 'W',
        assigneeUserId: bia,
      });

      await changeOrgRole(organizationId, ana, bia, 'member');

      expect(await assigneeOf(task.id)).toBeNull();
    });

    it('removed from or leaving the organization ⇒ success and assignee cleared by the database', async () => {
      const { organizationId, ana, mia, bia, web, inWeb, inApp } = await assignedWorld();

      await organizationUseCases().remove.execute(as(organizationId, ana), {
        userId: bia,
        version: await membershipVersion(organizationId, bia),
      });
      expect([await assigneeOf(inWeb), await assigneeOf(inApp)]).toEqual([null, null]);

      const task = await createTask(organizationId, mia, {
        projectId: web,
        title: 'M',
        assigneeUserId: mia,
      });
      await organizationUseCases().remove.execute(as(organizationId, mia), {
        userId: mia,
        version: await membershipVersion(organizationId, mia),
      });
      expect(await assigneeOf(task.id)).toBeNull();
    });

    it('reactions in one organization keep the assignments in another', async () => {
      const a = await assignedWorld();
      const zoe = randomUUID();
      const b = await organization({ [zoe]: 'owner', [a.bia]: 'member' });
      roles.set(`${b}|${zoe}`, 'owner');
      const project = await projects.useCases.createProject.execute(as(b, zoe), {
        key: 'WEB',
        name: 'Outro',
      });
      await addMember(b, zoe, project.id, a.bia, 'member');
      const inB = await createTask(b, zoe, {
        projectId: project.id,
        title: 'B',
        assigneeUserId: a.bia,
      });

      await changeOrgRole(a.organizationId, a.ana, a.bia, 'viewer');
      await organizationUseCases().remove.execute(as(a.organizationId, a.ana), {
        userId: a.bia,
        version: await membershipVersion(a.organizationId, a.bia),
      });

      expect(await assigneeOf(inB.id)).toBe(a.bia);
    });
  });
});
