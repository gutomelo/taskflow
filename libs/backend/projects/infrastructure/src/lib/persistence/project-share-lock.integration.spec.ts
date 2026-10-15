import { randomUUID } from 'node:crypto';
import type { ProjectRole } from '@taskflow/backend/shared/kernel';
import {
  createPrismaClient,
  PrismaTransactionRunner,
  TransactionRequiredError,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import {
  defaultWorkflow,
  Project,
  ProjectKey,
  ProjectMember,
  ProjectName,
} from '@taskflow/backend/projects/domain';
import { PrismaProjectMemberRepository } from './prisma-project-member.repository';
import { PrismaProjectRepository } from './prisma-project.repository';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Spec 004 (T5): o `FOR SHARE` do projeto, tomado pelas escritas de `tasks`, serializa com o
 * arquivamento (`FOR NO KEY UPDATE`) e convive com outras escritas de tarefa.
 */
describe('project share lock and contribution reads (integration, spec 004 T5)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let projects: PrismaProjectRepository;
  let members: PrismaProjectMemberRepository;
  const now = new Date('2026-10-14T10:00:00.000Z');

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma, { timeoutMs: 10_000 });
    projects = new PrismaProjectRepository(transactions);
    members = new PrismaProjectMemberRepository(transactions);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE organizations CASCADE`;
  });

  async function organization(userIds: ReadonlyArray<string> = []) {
    const id = randomUUID();
    await prisma.organization.create({
      data: { id, name: 'Acme', slug: `org-${id.slice(0, 8)}`, createdAt: now },
    });
    for (const userId of userIds) {
      await prisma.membership.create({
        data: { id: randomUUID(), organizationId: id, userId, role: 'member', createdAt: now },
      });
    }
    return id;
  }

  async function project(organizationId: string, key: string) {
    const created = Project.create({
      id: randomUUID(),
      organizationId,
      key: ProjectKey.create(key),
      name: ProjectName.create(key),
      description: null,
      createdByUserId: randomUUID(),
      now,
    });
    await transactions.run(() => projects.add(created, defaultWorkflow(randomUUID)));
    return created.id;
  }

  function participate(
    organizationId: string,
    projectId: string,
    userId: string,
    role: ProjectRole,
  ) {
    return members.add(
      ProjectMember.create({
        id: randomUUID(),
        organizationId,
        projectId,
        userId,
        role,
        organizationRole: 'member',
        now,
      }),
    );
  }

  /** Segura o `FOR SHARE` por `holdMs` e registra quando a transação termina. */
  function holdShareLock(
    organizationId: string,
    projectId: string,
    order: string[],
    holdMs: number,
  ) {
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const done = transactions.run(async () => {
      await projects.lockForShare(organizationId, { projectId });
      locked();
      await sleep(holdMs);
      order.push('share released');
    });
    return { isLocked, done };
  }

  it('locks by id or key within the organization only, and fails closed outside a transaction', async () => {
    const [a, b] = [await organization(), await organization()];
    const projectId = await project(a, 'WEB');
    const sameKeyInB = await project(b, 'WEB');

    expect((await transactions.run(() => projects.lockForShare(b, { key: 'WEB' })))?.id).toBe(
      sameKeyInB,
    );
    const byKey = await transactions.run(() => projects.lockForShare(a, { key: 'WEB' }));
    expect(byKey?.id).toBe(projectId);
    expect(await transactions.run(() => projects.lockForShare(a, { projectId }))).not.toBeNull();
    expect(await transactions.run(() => projects.lockForShare(b, { projectId }))).toBeNull();
    expect(await transactions.run(() => projects.lockForShare(b, { key: 'APP' }))).toBeNull();
    await expect(projects.lockForShare(a, { projectId })).rejects.toBeInstanceOf(
      TransactionRequiredError,
    );
  });

  it('holds archiving until the commit of the tasks transaction', async () => {
    const organizationId = await organization();
    const projectId = await project(organizationId, 'WEB');
    const order: string[] = [];
    const share = holdShareLock(organizationId, projectId, order, 400);
    await share.isLocked;

    const archive = transactions.run(async () => {
      const locked = await projects.lockForUpdate(organizationId, projectId);
      if (!locked) throw new Error('project not found');
      locked.archive(new Date());
      await projects.save(locked);
      order.push('archived');
    });
    await Promise.all([share.done, archive]);

    expect(order).toEqual(['share released', 'archived']);
  });

  it('lets other tasks transactions share the project lock in parallel', async () => {
    const organizationId = await organization();
    const projectId = await project(organizationId, 'WEB');
    const order: string[] = [];
    const share = holdShareLock(organizationId, projectId, order, 400);
    await share.isLocked;

    await transactions.run(async () => {
      expect(await projects.lockForShare(organizationId, { projectId })).not.toBeNull();
      order.push('second share locked');
    });
    await share.done;

    expect(order).toEqual(['second share locked', 'share released']);
  });

  it('reads participations by person, by project and filtered by role', async () => {
    const [ana, bia, caio] = [randomUUID(), randomUUID(), randomUUID()];
    const a = await organization([ana, bia, caio]);
    const b = await organization([ana]);
    const [web, app] = [await project(a, 'WEB'), await project(a, 'APP')];
    const elsewhere = await project(b, 'WEB');
    await transactions.run(async () => {
      await participate(a, web, ana, 'manager');
      await participate(a, web, bia, 'viewer');
      await participate(a, web, caio, 'member');
      await participate(a, app, ana, 'viewer');
      await participate(b, elsewhere, ana, 'member');
    });

    expect(await members.rolesOf(a, web, [ana, bia, randomUUID()])).toEqual(
      new Map([
        [ana, 'manager'],
        [bia, 'viewer'],
      ]),
    );
    expect(await members.rolesOf(b, web, [ana])).toEqual(new Map());
    expect(
      [...(await members.listForUser(a, ana))].sort((x, y) =>
        x.projectId.localeCompare(y.projectId),
      ),
    ).toEqual(
      [
        { projectId: web, role: 'manager' },
        { projectId: app, role: 'viewer' },
      ].sort((x, y) => x.projectId.localeCompare(y.projectId)),
    );
    const contributors = await members.listPage(a, web, { limit: 10, cursor: null }, [
      'manager',
      'member',
    ]);
    expect(contributors.items.map((member) => member.userId).sort()).toEqual([ana, caio].sort());
    expect((await members.listPage(a, web, { limit: 10, cursor: null })).items).toHaveLength(3);
  });
});
