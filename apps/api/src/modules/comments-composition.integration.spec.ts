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
import { createCollaborationUserDirectory } from './adapters/collaboration-user-directory.adapter';
import { createContributorChanges } from './adapters/contributor-changes.adapter';
import { createMembershipRoleChanges } from './adapters/membership-role-changes.adapter';
import { createOrganizationAccess } from './adapters/organization-access.adapter';
import { createProjectAccess } from './adapters/project-access.adapter';
import { createTaskDiscussionAccess } from './adapters/task-discussion-access.adapter';
import { createWorkflowStatusUsage } from './adapters/workflow-status-usage.adapter';
import { createCollaborationModule } from './collaboration.module';
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
 * Spec 010, T6: comentários com a composição real (mesma ordem de montagem de `main.ts`, uma
 * instância do runner, adaptadores reais) e PostgreSQL. `identity` entra só com nomes e busca em
 * memória. CA-07 (concorrência com cancelar, excluir e perda de acesso) e RF-15 ("Ex-membro").
 */
describe('comments composition (integration, spec 010 T6)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let projects: ReturnType<typeof createProjectsModule>;
  let tasks: ReturnType<typeof createTasksModule>;
  let tasksFoundation: ReturnType<typeof createTasksFoundation>;
  let collaboration: ReturnType<typeof createCollaborationModule>;
  const accounts = new Map<string, { name: string; email: string }>();
  const clock = new FixedClock(new Date());

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma, { timeoutMs: 20_000 });
    const idGenerator = new UuidV7Generator();
    const rateLimiter = new InMemoryRateLimiter();
    const logger = pino({ level: 'silent' });
    tasksFoundation = createTasksFoundation({ transactions, clock });
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
    tasks = createTasksModule({
      foundation: tasksFoundation,
      logger,
      transactions,
      outbox: new PrismaOutboxWriter(transactions),
      rateLimiter,
      idGenerator,
      clock,
      projectAccess: createProjectAccess(projects),
      users: new InMemoryTaskUserDirectory(),
    });
    // `identity` em memória: só o que as portas de `collaboration` usam.
    const identity = {
      userAccounts: {
        execute: async (userIds: readonly string[]) =>
          userIds.flatMap((id) => {
            const account = accounts.get(id);
            return account ? [{ id, ...account, emailVerified: true }] : [];
          }),
      },
      searchUsersAmong: {
        execute: async (
          userIds: readonly string[],
          query: string,
          page: Readonly<{ limit: number; cursor: string | null }>,
        ) => ({
          items: userIds
            .flatMap((id) => {
              const account = accounts.get(id);
              return account && account.name.includes(query)
                ? [{ id, ...account, emailVerified: true }]
                : [];
            })
            .sort((a, b) => (a.name < b.name ? -1 : 1))
            .slice(0, page.limit),
          nextCursor: null,
        }),
      },
    };
    collaboration = createCollaborationModule({
      logger,
      transactions,
      outbox: new PrismaOutboxWriter(transactions),
      rateLimiter,
      idGenerator,
      clock,
      discussion: createTaskDiscussionAccess({ tasks, projects, identity }),
      users: createCollaborationUserDirectory({ organizations, identity }),
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

  /** ana owner; mia member que cria WEB (gerente); bia member e vivi viewer participantes; otto sem acesso. */
  async function world() {
    const organizationId = randomUUID();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Acme',
        slug: `o-${organizationId.slice(0, 8)}`,
        createdAt: new Date(),
      },
    });
    const people = {
      ana: randomUUID(),
      mia: randomUUID(),
      bia: randomUUID(),
      vivi: randomUUID(),
      otto: randomUUID(),
    };
    const organizationRoles: Record<keyof typeof people, OrganizationRole> = {
      ana: 'owner',
      mia: 'member',
      bia: 'member',
      vivi: 'viewer',
      otto: 'member',
    };
    for (const person of ['ana', 'mia', 'bia', 'vivi', 'otto'] as const) {
      const userId = people[person];
      const role = organizationRoles[person];
      await prisma.membership.create({
        data: { id: randomUUID(), organizationId, userId, role, createdAt: new Date() },
      });
      roles.set(`${organizationId}|${userId}`, role);
      accounts.set(userId, { name: person.toUpperCase(), email: `${person}@exemplo.com` });
    }
    const project = await projects.useCases.createProject.execute(as(organizationId, people.mia), {
      key: 'WEB',
      name: 'Website',
    });
    for (const [userId, role] of [
      [people.bia, 'member'],
      [people.vivi, 'viewer'],
    ] as const) {
      await projects.useCases.addMember.execute(as(organizationId, people.mia), {
        projectId: project.id,
        userId,
        role,
      });
    }
    const task = await tasks.useCases.createTask.execute(as(organizationId, people.mia), {
      projectId: project.id,
      title: 'Tarefa',
    });
    return { organizationId, projectId: project.id, taskId: task.id, ...people };
  }

  const comment = (organizationId: string, userId: string, taskId: string, body: string) =>
    collaboration.useCases.createComment.execute(as(organizationId, userId), { taskId, body });

  it('mentions every reader (owner and viewer included), names them, and shows ex-members without name', async () => {
    const { organizationId, taskId, ana, mia, bia, vivi, otto } = await world();

    const created = await comment(organizationId, bia, taskId, `oi <@${ana}> <@${vivi}> <@${mia}>`);
    expect(created.mentions.map((mention) => mention.name)).toEqual(['ANA', 'VIVI', 'MIA']);
    expect(await outcome(comment(organizationId, bia, taskId, `<@${otto}>`))).toBe(
      'INVALID_MENTION',
    );
    expect(await prisma.commentMention.count()).toBe(3);

    const candidates = await collaboration.useCases.listMentionCandidates.execute(
      as(organizationId, bia),
      { taskId, query: 'A' },
    );
    expect(candidates.items.map((item) => item.name).sort()).toEqual(['ANA', 'MIA']);

    await prisma.membership.deleteMany({ where: { organizationId, userId: vivi } });
    const page = await collaboration.useCases.listComments.execute(as(organizationId, mia), {
      taskId,
    });
    expect(page.items[0]?.mentions).toEqual([
      { userId: ana, name: 'ANA' },
      { userId: vivi, name: null },
      { userId: mia, name: 'MIA' },
    ]);
    expect(page.count).toBe(1);
  });

  it('CA-07: canceling the task while a comment holds it waits; a comment after the cancel is refused', async () => {
    const { organizationId, projectId, taskId, mia, bia } = await world();
    const order: string[] = [];
    let held: () => void = () => undefined;
    const isHeld = new Promise<void>((resolve) => (held = resolve));

    const holding = transactions.run(async () => {
      await tasksFoundation.tasks.lockForShare(organizationId, projectId, taskId);
      held();
      await sleep(300);
      order.push('comment committed');
    });
    await isHeld;
    const cancel = tasks.useCases.cancelTask
      .execute(as(organizationId, mia), { taskId, version: 1 })
      .then(() => order.push('canceled'));
    await Promise.all([holding, cancel]);

    expect(order).toEqual(['comment committed', 'canceled']);
    expect(await outcome(comment(organizationId, bia, taskId, 'tarde demais'))).toBe(
      'TASK_CANCELED',
    );
  });

  it('CA-07: a comment waits for a cancel in progress and then sees the task canceled', async () => {
    const { organizationId, projectId, taskId, bia } = await world();
    let held: () => void = () => undefined;
    const isHeld = new Promise<void>((resolve) => (held = resolve));

    const canceling = transactions.run(async () => {
      await tasksFoundation.tasks.lockById(organizationId, projectId, taskId);
      held();
      await sleep(300);
      await transactions.client().task.updateMany({
        where: { organizationId, id: taskId },
        data: { canceledAt: new Date(), canceledByUserId: bia },
      });
    });
    await isHeld;
    const result = await outcome(comment(organizationId, bia, taskId, 'oi'));
    await canceling;

    expect(result).toBe('TASK_CANCELED');
    expect(await prisma.comment.count()).toBe(0);
  });

  it('CA-07: deleting the task while a comment is written either deletes it too or refuses the comment', async () => {
    const { organizationId, taskId, mia, bia } = await world();

    const results = await Promise.all([
      outcome(comment(organizationId, bia, taskId, 'oi')),
      outcome(tasks.useCases.deleteTask.execute(as(organizationId, mia), { taskId, version: 1 })),
    ]);

    expect(results[1]).toBe('ok');
    expect(results[0]).toMatch(/^(ok|TASK_NOT_FOUND)$/);
    expect(await prisma.comment.count()).toBe(0);
  });

  it('CA-07: removing the mentioned person from the project waits for the comment holding the membership', async () => {
    const { organizationId, projectId, taskId, mia, bia, vivi } = await world();
    const order: string[] = [];
    let held: () => void = () => undefined;
    const isHeld = new Promise<void>((resolve) => (held = resolve));

    const holding = transactions.run(async () => {
      const lock = await tasks.discussion.lockForComment.execute(organizationId, taskId, [
        bia,
        vivi,
      ]);
      expect(lock?.effectiveRoles.get(vivi)).toBe('viewer');
      held();
      await sleep(300);
      order.push('comment committed');
    });
    await isHeld;
    const removal = projects.useCases.removeMember
      .execute(as(organizationId, mia), { projectId, userId: vivi, version: 1 })
      .then(() => order.push('removed'));
    await Promise.all([holding, removal]);

    expect(order).toEqual(['comment committed', 'removed']);
    expect(await outcome(comment(organizationId, bia, taskId, `<@${vivi}>`))).toBe(
      'INVALID_MENTION',
    );
  });

  it('a manager moderates on a canceled task; editing there is refused; the organization takes the conversation away', async () => {
    const { organizationId, taskId, mia, bia } = await world();
    const created = await comment(organizationId, bia, taskId, 'senha: 123');
    await tasks.useCases.cancelTask.execute(as(organizationId, mia), { taskId, version: 1 });

    expect(
      await outcome(
        collaboration.useCases.editComment.execute(as(organizationId, bia), {
          commentId: created.id,
          body: 'x',
          version: 1,
        }),
      ),
    ).toBe('TASK_CANCELED');
    await collaboration.useCases.deleteComment.execute(as(organizationId, mia), {
      commentId: created.id,
      version: 1,
    });
    expect(await prisma.comment.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      body: null,
      deletedByUserId: mia,
    });

    await prisma.organization.delete({ where: { id: organizationId } });
    expect(await prisma.comment.count()).toBe(0);
  });
});
