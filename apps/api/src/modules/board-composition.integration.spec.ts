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
import type { OrganizationRole } from '@taskflow/backend/shared/kernel';
import { InMemoryUserDirectory } from '@taskflow/backend/organizations/application/testing';
import { InMemoryProjectsUserDirectory } from '@taskflow/backend/projects/application/testing';
import { InMemoryTaskUserDirectory } from '@taskflow/backend/tasks/application/testing';
import { createContributorChanges } from './adapters/contributor-changes.adapter';
import { createMembershipRoleChanges } from './adapters/membership-role-changes.adapter';
import { createOrganizationAccess } from './adapters/organization-access.adapter';
import { createProjectAccess } from './adapters/project-access.adapter';
import { createWorkflowStatusUsage } from './adapters/workflow-status-usage.adapter';
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
 * Spec 005, T7: quadro e workflow com a composição real (mesma ordem de montagem de `main.ts`,
 * uma instância do runner) e PostgreSQL. RNF-02 (BR-004, BR-009, BR-010 sob concorrência), CA-07
 * (workflow × quadro) e a obrigação 5 da 004 (cascata da organização).
 */
describe('board composition (integration, spec 005 T7)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let projects: ReturnType<typeof createProjectsModule>;
  let tasks: ReturnType<typeof createTasksModule>;
  let projectAccess: ReturnType<typeof createProjectAccess>;
  const clock = new FixedClock(new Date());

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma, { timeoutMs: 20_000 });
    const idGenerator = new UuidV7Generator();
    const rateLimiter = new InMemoryRateLimiter();
    const logger = pino({ level: 'silent' });
    const tasksFoundation = createTasksFoundation({ transactions, clock });
    const projectsFoundation = createProjectsFoundation({
      transactions,
      clock,
      contributorChanges: createContributorChanges(tasksFoundation),
      workflowStatusUsage: createWorkflowStatusUsage(tasksFoundation),
    });
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
      membershipRoleChanges: createMembershipRoleChanges(projectsFoundation),
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
      outbox: new PrismaOutboxWriter(transactions),
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

  /** mia (member) cria WEB e é gerente; bia é member participante. */
  async function world() {
    const organizationId = randomUUID();
    const [mia, bia] = [randomUUID(), randomUUID()];
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Acme',
        slug: `o-${organizationId.slice(0, 8)}`,
        createdAt: new Date(),
      },
    });
    for (const userId of [mia, bia]) {
      await prisma.membership.create({
        data: { id: randomUUID(), organizationId, userId, role: 'member', createdAt: new Date() },
      });
      roles.set(`${organizationId}|${userId}`, 'member');
    }
    const project = await projects.useCases.createProject.execute(as(organizationId, mia), {
      key: 'WEB',
      name: 'Website',
    });
    await projects.useCases.addMember.execute(as(organizationId, mia), {
      projectId: project.id,
      userId: bia,
      role: 'member',
    });
    const workflow = await projects.useCases.getWorkflow.execute(
      as(organizationId, mia),
      project.id,
    );
    const [todo, doing, done] = workflow.statuses.map((status) => status.id);
    if (!todo || !doing || !done) throw new Error('default workflow');
    const create = (title: string, actor = mia) =>
      tasks.useCases.createTask.execute(as(organizationId, actor), {
        projectId: project.id,
        title,
      });
    return {
      organizationId,
      mia,
      bia,
      projectId: project.id,
      status: { todo, doing, done },
      create,
    };
  }

  const versionOf = async (taskId: string) =>
    (await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { version: true } }))
      .version;

  async function column(
    organizationId: string,
    userId: string,
    projectId: string,
    statusId: string,
  ) {
    const board = await tasks.useCases.getBoard.execute(as(organizationId, userId), {
      projectId,
      limit: 50,
    });
    return (
      board.columns.find((entry) => entry.statusId === statusId)?.cards.map((card) => card.key) ??
      []
    );
  }

  it('BR-009: two cards dropped at the same point at the same time both persist, in a deterministic order', async () => {
    const { organizationId, mia, bia, projectId, status, create } = await world();
    const [a, b, c, d] = [
      await create('A'),
      await create('B'),
      await create('C'),
      await create('D'),
    ];

    const results = await Promise.all([
      outcome(
        tasks.useCases.moveCard.execute(as(organizationId, mia), {
          taskId: c.id,
          toStatusId: status.todo,
          afterTaskId: a.id,
          version: 1,
        }),
      ),
      outcome(
        tasks.useCases.moveCard.execute(as(organizationId, bia), {
          taskId: d.id,
          toStatusId: status.todo,
          afterTaskId: a.id,
          version: 1,
        }),
      ),
    ]);

    expect(results).toEqual(['ok', 'ok']);
    const order = await column(organizationId, mia, projectId, status.todo);
    expect(order).toHaveLength(4);
    expect(order[0]).toBe('WEB-1');
    expect(order.at(-1)).toBe('WEB-2');
    expect(new Set(order.slice(1, 3))).toEqual(new Set(['WEB-3', 'WEB-4']));
    expect(b.key).toBe('WEB-2');
  });

  it('B2: cards with tied ranks accept a card between them (the column is rebalanced)', async () => {
    const { organizationId, mia, projectId, status, create } = await world();
    const [a, b, c] = [await create('A'), await create('B'), await create('C')];
    await prisma.task.updateMany({
      where: { id: { in: [a.id, b.id] } },
      data: { boardRank: 'a5' },
    });
    const [first, second] = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1));

    await tasks.useCases.moveCard.execute(as(organizationId, mia), {
      taskId: c.id,
      toStatusId: status.todo,
      afterTaskId: first?.id ?? '',
      version: 1,
    });

    expect(await column(organizationId, mia, projectId, status.todo)).toEqual([
      first?.key,
      'WEB-3',
      second?.key,
    ]);
    const ranks = await prisma.task.findMany({ where: { projectId }, select: { boardRank: true } });
    expect(new Set(ranks.map((row) => row.boardRank)).size).toBe(3);
  });

  it('a rebalance and a concurrent creation never lose a card', async () => {
    const { organizationId, mia, projectId, status, create } = await world();
    const cards = [];
    for (let index = 0; index < 6; index += 1) cards.push(await create(`T${index}`));
    await prisma.task.updateMany({
      where: { id: { in: cards.slice(0, 2).map((card) => card.id) } },
      data: { boardRank: 'a5' },
    });
    const [first] = cards.slice(0, 2).sort((x, y) => (x.id < y.id ? -1 : 1));
    const mover = cards[5];

    const results = await Promise.all([
      outcome(
        tasks.useCases.moveCard.execute(as(organizationId, mia), {
          taskId: mover?.id ?? '',
          toStatusId: status.todo,
          afterTaskId: first?.id ?? '',
          version: 1,
        }),
      ),
      outcome(create('Concorrente')),
    ]);

    expect(results).toEqual(['ok', 'ok']);
    expect(await column(organizationId, mia, projectId, status.todo)).toHaveLength(7);
  });

  it('CA-07: removing the target column while a card moves into it never leaves a task in a removed status', async () => {
    const { organizationId, mia, bia, projectId, status, create } = await world();
    const review = await projects.useCases.createStatus.execute(as(organizationId, mia), {
      projectId,
      name: 'Em revisão',
      category: 'in_progress',
      version: 1,
    });
    const reviewId = review.statuses.find((entry) => entry.name === 'Em revisão')?.id ?? '';
    await projects.useCases.replaceTransitions.execute(as(organizationId, mia), {
      projectId,
      transitions: [{ fromStatusId: status.todo, toStatusId: reviewId }],
      version: 2,
    });
    const task = await create('Card');

    const results = await Promise.all([
      outcome(
        tasks.useCases.moveCard.execute(as(organizationId, bia), {
          taskId: task.id,
          toStatusId: reviewId,
          version: 1,
        }),
      ),
      outcome(
        projects.useCases.removeStatus.execute(as(organizationId, mia), {
          projectId,
          statusId: reviewId,
          moveTasksToStatusId: status.doing,
          version: 3,
        }),
      ),
    ]);

    expect(results[1]).toBe('ok');
    expect(results[0]).toMatch(/^(ok|STATUS_NOT_FOUND)$/);
    const row = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { statusId: true },
    });
    expect(row.statusId).toBe(results[0] === 'ok' ? status.doing : status.todo);
    expect(await prisma.workflowStatus.count({ where: { id: reviewId } })).toBe(0);
  });

  it('CA-07: replacing the transitions waits for a move holding the project; the next move sees the new rules', async () => {
    const { organizationId, mia, bia, status, create, projectId } = await world();
    const [a, b] = [await create('A'), await create('B')];
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

    const moving = tasks.useCases.moveCard
      .execute(as(organizationId, bia), { taskId: a.id, toStatusId: status.doing, version: 1 })
      .then(() => order.push('moved'));
    await isReached;
    projectAccess.lockForContribution = lockForContribution;
    const replacing = projects.useCases.replaceTransitions
      .execute(as(organizationId, mia), { projectId, transitions: [], version: 1 })
      .then(() => order.push('replaced'));
    await sleep(300);
    order.push('released');
    release();
    await Promise.all([moving, replacing]);

    expect(order).toEqual(['released', 'moved', 'replaced']);
    expect(
      await outcome(
        tasks.useCases.moveCard.execute(as(organizationId, bia), {
          taskId: b.id,
          toStatusId: status.doing,
          version: await versionOf(b.id),
        }),
      ),
    ).toBe('TRANSITION_NOT_ALLOWED');
  });

  it('changing the category of the initial status while a task is created: refused if it got a task, else the task goes to the new initial status', async () => {
    const { organizationId, mia, projectId, status, create } = await world();
    const backlog = await projects.useCases.createStatus.execute(as(organizationId, mia), {
      projectId,
      name: 'Backlog',
      category: 'todo',
      version: 1,
    });
    const backlogId = backlog.statuses.find((entry) => entry.name === 'Backlog')?.id ?? '';

    const [created, changed] = await Promise.all([
      create('Nova'),
      outcome(
        projects.useCases.updateStatus.execute(as(organizationId, mia), {
          projectId,
          statusId: status.todo,
          category: 'in_progress',
          version: 2,
        }),
      ),
    ]);

    const row = await prisma.task.findUniqueOrThrow({
      where: { id: created.id },
      select: { statusId: true },
    });
    if (changed === 'ok') expect(row.statusId).toBe(backlogId);
    else {
      expect(changed).toBe('STATUS_IN_USE');
      expect(row.statusId).toBe(status.todo);
    }
  });

  it('removing a status with tasks reassigns all of them (canceled and subtasks too), keeping the relative order', async () => {
    const { organizationId, mia, projectId, status, create } = await world();
    const review = await projects.useCases.createStatus.execute(as(organizationId, mia), {
      projectId,
      name: 'Em revisão',
      category: 'in_progress',
      version: 1,
    });
    const reviewId = review.statuses.find((entry) => entry.name === 'Em revisão')?.id ?? '';
    const [a, b, c] = [await create('A'), await create('B'), await create('C')];
    await prisma.task.updateMany({
      where: { id: { in: [a.id, c.id] } },
      data: { statusId: reviewId },
    });
    await prisma.task.update({ where: { id: b.id }, data: { statusId: status.doing } });
    const canceled = await create('Cancelada');
    await prisma.task.update({
      where: { id: canceled.id },
      data: { statusId: reviewId, canceledAt: new Date(), canceledByUserId: mia },
    });

    const workflow = await projects.useCases.removeStatus.execute(as(organizationId, mia), {
      projectId,
      statusId: reviewId,
      moveTasksToStatusId: status.doing,
      version: 2,
    });

    expect(workflow.statuses.map((entry) => entry.name)).toEqual([
      'A fazer',
      'Em andamento',
      'Concluído',
    ]);
    expect(await prisma.task.count({ where: { projectId, statusId: status.doing } })).toBe(4);
    expect(await column(organizationId, mia, projectId, status.doing)).toEqual([
      'WEB-1',
      'WEB-2',
      'WEB-3',
    ]);
    expect(await versionOf(a.id)).toBe(2);
  });

  it('obligation 5 of spec 004: deleting the organization removes projects, workflow, tasks and dependencies', async () => {
    const { organizationId, mia, create } = await world();
    const [a, b] = [await create('A'), await create('B')];
    await tasks.useCases.createTask.execute(as(organizationId, mia), {
      projectId: (await prisma.task.findUniqueOrThrow({ where: { id: a.id } })).projectId,
      title: 'Filha',
      parentTaskId: a.id,
      isRequired: true,
    });
    await tasks.useCases.addDependency.execute(as(organizationId, mia), {
      taskId: a.id,
      blockingTaskId: b.id,
    });

    await prisma.organization.delete({ where: { id: organizationId } });

    for (const count of [
      prisma.task.count({ where: { organizationId } }),
      prisma.taskDependency.count({ where: { organizationId } }),
      prisma.workflowStatus.count({ where: { organizationId } }),
      prisma.project.count({ where: { organizationId } }),
    ]) {
      expect(await count).toBe(0);
    }
  });
});
