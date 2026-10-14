import { randomUUID } from 'node:crypto';
import { VersionConflictError } from '@taskflow/backend/shared/kernel';
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
  Task,
  TaskNotFoundError,
  TaskTitle,
  type WorkflowStatusView,
} from '@taskflow/backend/tasks/domain';
import { PrismaTaskDependencyRepository } from './prisma-task-dependency.repository';
import { PrismaTaskRepository } from './prisma-task.repository';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('tasks persistence (integration, T3)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let tasks: PrismaTaskRepository;
  let dependencies: PrismaTaskDependencyRepository;
  const now = new Date('2026-10-14T10:00:00.000Z');

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma, { timeoutMs: 10_000 });
    tasks = new PrismaTaskRepository(transactions);
    dependencies = new PrismaTaskDependencyRepository(transactions);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE organizations CASCADE`;
  });

  async function organization() {
    const id = randomUUID();
    await prisma.organization.create({
      data: { id, name: 'Acme', slug: `org-${id.slice(0, 8)}`, createdAt: now },
    });
    return id;
  }

  async function member(organizationId: string, userId = randomUUID()) {
    await prisma.membership.create({
      data: { id: randomUUID(), organizationId, userId, role: 'member', createdAt: now },
    });
    return userId;
  }

  async function project(organizationId: string, key = 'WEB') {
    const id = randomUUID();
    await prisma.project.create({
      data: { id, organizationId, key, name: key, createdByUserId: randomUUID(), createdAt: now },
    });
    const status: WorkflowStatusView = {
      id: randomUUID(),
      name: 'A fazer',
      category: 'todo',
      position: 0,
    };
    await prisma.workflowStatus.create({ data: { ...status, organizationId, projectId: id } });
    return { id, status };
  }

  async function task(
    organizationId: string,
    target: { id: string; status: WorkflowStatusView },
    overrides: Partial<{
      parentTaskId: string;
      isRequired: boolean;
      assigneeUserId: string;
      priority: 'high' | 'none';
    }> = {},
  ) {
    const created = await transactions.run(async () =>
      Task.create({
        id: randomUUID(),
        organizationId,
        projectId: target.id,
        number: await tasks.nextNumber(organizationId, target.id),
        title: TaskTitle.create('Tarefa'),
        description: null,
        status: target.status,
        priority: overrides.priority ?? 'none',
        assigneeUserId: overrides.assigneeUserId ?? null,
        dueDate: '2026-12-31',
        parentTaskId: overrides.parentTaskId ?? null,
        isRequired: overrides.isRequired ?? false,
        createdByUserId: randomUUID(),
        now,
      }),
    );
    await tasks.add(created, `e${String(created.toSnapshot().number).padStart(5, '0')}`);
    return created;
  }

  it('BR-028: concurrent creations get distinct sequential numbers per project', async () => {
    const organizationId = await organization();
    const [p1, p2] = [await project(organizationId, 'WEB'), await project(organizationId, 'APP')];

    const numbers = await Promise.all(
      Array.from({ length: 20 }, () =>
        transactions.run(() => tasks.nextNumber(organizationId, p1.id)),
      ),
    );

    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await transactions.run(() => tasks.nextNumber(organizationId, p2.id))).toBe(1);
    await expect(tasks.nextNumber(organizationId, p1.id)).rejects.toBeInstanceOf(
      TransactionRequiredError,
    );
  });

  it('the project lock serializes invariant checks between tasks and requires a transaction', async () => {
    const organizationId = await organization();
    const target = await project(organizationId);
    const order: string[] = [];
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));

    const first = transactions.run(async () => {
      await tasks.lockProject(organizationId, target.id);
      locked();
      await sleep(300);
      order.push('first released');
    });
    await isLocked;
    await transactions.run(async () => {
      await tasks.lockProject(organizationId, target.id);
      order.push('second locked');
    });
    await first;

    expect(order).toEqual(['first released', 'second locked']);
    await expect(tasks.lockProject(organizationId, target.id)).rejects.toBeInstanceOf(
      TransactionRequiredError,
    );
  });

  it('finds, saves and removes with the organization, project and version', async () => {
    const [a, b] = [await organization(), await organization()];
    const target = await project(a);
    const created = await task(a, target);

    expect((await tasks.findById(a, created.id))?.toSnapshot()).toMatchObject({
      number: 1,
      dueDate: '2026-12-31',
    });
    expect(await tasks.findById(b, created.id)).toBeNull();
    expect((await tasks.findByNumber(a, target.id, 1))?.id).toBe(created.id);

    const fresh = await transactions.run(() => tasks.lockById(a, target.id, created.id));
    if (!fresh) throw new Error('task not found');
    fresh.edit({ priority: 'urgent' }, now);
    await tasks.save(fresh);
    await expect(tasks.save(fresh)).rejects.toBeInstanceOf(VersionConflictError);
    await expect(tasks.remove(a, target.id, created.id, 1)).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    await tasks.remove(a, target.id, created.id, 2);
    expect(await tasks.findById(a, created.id)).toBeNull();
  });

  it('lists by number desc with filters and an opaque cursor; subtasks only on demand', async () => {
    const organizationId = await organization();
    const target = await project(organizationId);
    const assignee = await member(organizationId);
    const t1 = await task(organizationId, target, { assigneeUserId: assignee, priority: 'high' });
    const t2 = await task(organizationId, target);
    const t3 = await task(organizationId, target);
    const sub = await task(organizationId, target, { parentTaskId: t1.id, isRequired: true });
    const canceled = await transactions.run(() => tasks.lockById(organizationId, target.id, t3.id));
    if (!canceled) throw new Error('task not found');
    canceled.cancel(assignee, now);
    await tasks.save(canceled);
    const list = (
      filter: Partial<Parameters<PrismaTaskRepository['listPage']>[2]>,
      cursor: string | null = null,
    ) =>
      tasks.listPage(
        organizationId,
        target.id,
        { includeCanceled: false, parentTaskId: null, ...filter },
        { limit: 1, cursor },
      );

    const first = await list({});
    const second = await list({}, first.nextCursor);
    expect([first, second].flatMap((page) => page.items.map((item) => item.id))).toEqual([
      t2.id,
      t1.id,
    ]);
    expect(second.nextCursor).toBeNull();
    expect((await list({ includeCanceled: true })).items[0]?.id).toBe(t3.id);
    expect((await list({ assigneeUserId: assignee })).items[0]?.id).toBe(t1.id);
    expect((await list({ unassigned: true })).items[0]?.id).toBe(t2.id);
    // As duas condições valem juntas (E lógico): sem responsável e de uma pessoa ⇒ nada.
    expect((await list({ unassigned: true, assigneeUserId: assignee })).items).toEqual([]);
    expect((await list({ priority: 'high' })).items[0]?.id).toBe(t1.id);
    expect((await list({ parentTaskId: t1.id })).items[0]?.id).toBe(sub.id);
    expect((await list({}, 'not-a-cursor')).items[0]?.id).toBe(t2.id);
    expect(
      (await tasks.subtasksOf(organizationId, target.id, t1.id)).map((item) => item.id),
    ).toEqual([sub.id]);
    expect(await tasks.requiredSubtaskIds(organizationId, target.id, [t1.id, t2.id])).toEqual([
      sub.id,
    ]);
    expect(
      (await tasks.findByIds(organizationId, target.id, [t2.id, t1.id])).map((item) => item.id),
    ).toEqual([t1.id, t2.id]);
    expect(await tasks.countInOrganization(organizationId)).toBe(4);
  });

  it('BR-003: revokes assignments by scope, bumping versions, never in another organization', async () => {
    const [a, b] = [await organization(), await organization()];
    const [p1, p2] = [await project(a, 'WEB'), await project(a, 'APP')];
    const elsewhere = await project(b, 'WEB');
    const userId = await member(a);
    await member(b, userId);
    const [inP1, inP2, inB] = [
      await task(a, p1, { assigneeUserId: userId }),
      await task(a, p2, { assigneeUserId: userId }),
      await task(b, elsewhere, { assigneeUserId: userId }),
    ];

    await expect(
      tasks.revokeAssignments(a, userId, { kind: 'project', projectId: p1.id }, now),
    ).rejects.toBeInstanceOf(TransactionRequiredError);
    expect(
      await transactions.run(() =>
        tasks.revokeAssignments(a, userId, { kind: 'project', projectId: p1.id }, now),
      ),
    ).toBe(1);
    expect(
      await transactions.run(() =>
        tasks.revokeAssignments(
          a,
          userId,
          { kind: 'organization', exceptProjectIds: [p2.id] },
          now,
        ),
      ),
    ).toBe(0);
    const state = async (id: string, organizationId: string) =>
      (await tasks.findById(organizationId, id))?.toSnapshot();
    expect(await state(inP1.id, a)).toMatchObject({ assigneeUserId: null, version: 2 });
    expect(await state(inP2.id, a)).toMatchObject({ assigneeUserId: userId, version: 1 });
    expect(
      await transactions.run(() =>
        tasks.revokeAssignments(a, userId, { kind: 'organization', exceptProjectIds: [] }, now),
      ),
    ).toBe(1);
    expect(await state(inB.id, b)).toMatchObject({ assigneeUserId: userId, version: 1 });
  });

  it('dependencies: idempotent add, remove, both directions, counts, and 404 for deleted tasks', async () => {
    const organizationId = await organization();
    const target = await project(organizationId);
    const [x, y, z] = [
      await task(organizationId, target),
      await task(organizationId, target),
      await task(organizationId, target),
    ];

    expect(await dependencies.add(organizationId, target.id, x.id, y.id)).toBe(true);
    expect(await dependencies.add(organizationId, target.id, x.id, y.id)).toBe(false);
    await dependencies.add(organizationId, target.id, z.id, y.id);

    expect(await dependencies.blockersOf(organizationId, target.id, [x.id, z.id])).toEqual([
      y.id,
      y.id,
    ]);
    expect(await dependencies.blockedBy(organizationId, target.id, y.id, 1)).toHaveLength(1);
    expect(await dependencies.countBlockers(organizationId, target.id, x.id)).toBe(1);
    expect(await dependencies.countInProject(organizationId, target.id)).toBe(2);
    expect(await dependencies.remove(organizationId, target.id, x.id, y.id)).toBe(true);
    expect(await dependencies.remove(organizationId, target.id, x.id, y.id)).toBe(false);
    await tasks.remove(organizationId, target.id, z.id, 1);
    await expect(dependencies.add(organizationId, target.id, z.id, y.id)).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
  });
});

describe('board persistence (integration, spec 005 T4)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let tasks: PrismaTaskRepository;
  const now = new Date('2026-10-14T10:00:00.000Z');

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma, { timeoutMs: 10_000 });
    tasks = new PrismaTaskRepository(transactions);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE organizations CASCADE`;
  });

  /** Projeto com dois status (todo, in_progress) e cards com chaves dadas. */
  async function board(organizationId = randomUUID()) {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Acme',
        slug: `o-${organizationId.slice(0, 8)}`,
        createdAt: now,
      },
    });
    const projectId = randomUUID();
    await prisma.project.create({
      data: {
        id: projectId,
        organizationId,
        key: 'WEB',
        name: 'WEB',
        createdByUserId: randomUUID(),
        createdAt: now,
      },
    });
    const [todo, doing] = [randomUUID(), randomUUID()];
    await prisma.workflowStatus.createMany({
      data: [
        { id: todo, organizationId, projectId, name: 'A fazer', category: 'todo', position: 0 },
        {
          id: doing,
          organizationId,
          projectId,
          name: 'Fazendo',
          category: 'in_progress',
          position: 1,
        },
      ],
    });
    let number = 0;
    const card = async (
      boardRank: string,
      overrides: Partial<{
        statusId: string;
        parentTaskId: string;
        canceled: boolean;
        done: boolean;
      }> = {},
    ) => {
      number += 1;
      const id = randomUUID();
      await prisma.task.create({
        data: {
          id,
          organizationId,
          projectId,
          number,
          title: `T${number}`,
          statusId: overrides.statusId ?? todo,
          parentTaskId: overrides.parentTaskId ?? null,
          canceledAt: overrides.canceled ? now : null,
          canceledByUserId: overrides.canceled ? randomUUID() : null,
          completedAt: overrides.done ? now : null,
          completedByUserId: overrides.done ? randomUUID() : null,
          createdByUserId: randomUUID(),
          createdAt: now,
          boardRank,
        },
      });
      return id;
    };
    return { organizationId, projectId, todo, doing, card };
  }

  const ranksOf = async (organizationId: string, projectId: string, statusId: string) =>
    (
      await prisma.task.findMany({
        where: { organizationId, projectId, statusId, parentTaskId: null, canceledAt: null },
        orderBy: [{ boardRank: 'asc' }, { id: 'asc' }],
        select: { id: true, boardRank: true },
      })
    ).map((row) => [row.id, row.boardRank] as const);

  it('pages a column by (rank, id): only top-level, not canceled cards, ties by id', async () => {
    const { organizationId, projectId, todo, doing, card } = await board();
    const a = await card('a1');
    const [t1, t2] = [await card('a2'), await card('a2')];
    const c = await card('a3');
    await card('a0', { canceled: true });
    await card('a0', { parentTaskId: a });
    await card('a0', { statusId: doing });

    const first = await tasks.columnPage(organizationId, projectId, todo, {
      limit: 2,
      after: null,
    });
    const last = first.items.at(-1);
    const second = await tasks.columnPage(organizationId, projectId, todo, {
      limit: 5,
      after: last ? { id: last.task.id, rank: last.rank } : null,
    });

    const tie = [t1, t2].sort();
    expect(first.items.map((item) => item.task.id)).toEqual([a, tie[0]]);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.task.id)).toEqual([tie[1], c]);
    expect(second.hasMore).toBe(false);
    expect(await tasks.lastRankInColumn(organizationId, projectId, todo)).toBe('a3');
    expect(await tasks.lastRankInColumn(organizationId, projectId, todo, c)).toBe('a2');
    expect(await tasks.lastRankInColumn(organizationId, randomUUID(), todo)).toBeNull();
  });

  it('finds a card in its column and its neighbors, ignoring the moving card', async () => {
    const { organizationId, projectId, todo, doing, card } = await board();
    const a = await card('a1');
    const b = await card('a2');
    const moving = await card('a3');
    const sub = await card('a5', { parentTaskId: a });
    const other = await card('a1', { statusId: doing });

    const anchor = await tasks.cardInColumn(organizationId, projectId, todo, a);
    expect(anchor).toEqual({ id: a, rank: 'a1' });
    for (const id of [sub, other, randomUUID()]) {
      expect(await tasks.cardInColumn(organizationId, projectId, todo, id)).toBeNull();
    }
    expect(await tasks.cardInColumn(randomUUID(), projectId, todo, a)).toBeNull();
    if (!anchor) throw new Error('anchor');
    expect(
      await tasks.adjacentCard(organizationId, projectId, todo, anchor, 'next', moving),
    ).toEqual({ id: b, rank: 'a2' });
    const second = { id: b, rank: 'a2' };
    expect(
      await tasks.adjacentCard(organizationId, projectId, todo, second, 'next', moving),
    ).toBeNull();
    expect(
      await tasks.adjacentCard(organizationId, projectId, todo, second, 'previous', moving),
    ).toEqual(anchor);
  });

  it('counts subtasks per card without canceled ones', async () => {
    const { organizationId, projectId, card } = await board();
    const parent = await card('a1');
    const empty = await card('a2');
    await card('a0', { parentTaskId: parent, done: true });
    await card('a0', { parentTaskId: parent });
    await card('a0', { parentTaskId: parent, canceled: true });

    const counts = await tasks.subtaskCounts(organizationId, projectId, [parent, empty]);

    expect(counts.get(parent)).toEqual({ done: 1, total: 2 });
    expect(counts.has(empty)).toBe(false);
    expect(await tasks.subtaskCounts(organizationId, projectId, [])).toEqual(new Map());
  });

  it('places a card without touching its version; rebalances a column keeping the order, only in its tenant', async () => {
    const { organizationId, projectId, todo, card } = await board();
    const ids = [await card('a5'), await card('a6'), await card('a7')];
    // Ordem por chave inversa à ordem por id: o rebalanceamento tem de seguir a chave.
    const byId = [...ids].sort();
    const longRanks = ['a3', `a1${'V'.repeat(31)}`, `a1${'V'.repeat(30)}`];
    for (const [index, id] of byId.entries()) {
      await prisma.task.update({ where: { id }, data: { boardRank: longRanks[index] ?? 'a9' } });
    }
    const elsewhere = await board();
    const foreign = await elsewhere.card('a1');
    const target = byId[0] ?? '';

    await tasks.placeCard(organizationId, projectId, target, 'a4');
    expect(
      await prisma.task.findUniqueOrThrow({
        where: { id: target },
        select: { boardRank: true, version: true },
      }),
    ).toEqual({ boardRank: 'a4', version: 1 });
    const before = (await ranksOf(organizationId, projectId, todo)).map(([id]) => id);

    const rewritten = await transactions.run(() =>
      tasks.rebalanceColumn(organizationId, projectId, todo),
    );

    const after = await ranksOf(organizationId, projectId, todo);
    expect(rewritten).toBe(3);
    expect(before).toEqual([byId[2], byId[1], byId[0]]);
    expect(after.map(([id]) => id)).toEqual(before);
    expect(after.every(([, rank]) => rank.length <= 3)).toBe(true);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: foreign }, select: { boardRank: true } }))
        .boardRank,
    ).toBe('a1');
    await expect(tasks.rebalanceColumn(organizationId, projectId, todo)).rejects.toBeInstanceOf(
      TransactionRequiredError,
    );
  });

  it('counts every task by status and reassigns them all keeping the rank, bumping versions', async () => {
    const { organizationId, projectId, todo, doing, card } = await board();
    const parent = await card('a1', { statusId: doing });
    await card('a2', { statusId: doing, canceled: true });
    await card('a3', { statusId: doing, parentTaskId: parent });
    await card('a4');

    expect(await tasks.countByStatus(organizationId, projectId)).toEqual(
      new Map([
        [doing, 3],
        [todo, 1],
      ]),
    );
    const moved = await tasks.reassignStatus(organizationId, projectId, doing, todo, now);

    expect(moved).toBe(3);
    const rows = await prisma.task.findMany({
      where: { organizationId, projectId },
      orderBy: { boardRank: 'asc' },
      select: { statusId: true, boardRank: true, version: true },
    });
    expect(rows.map((row) => [row.boardRank, row.statusId === todo, row.version])).toEqual([
      ['a1', true, 2],
      ['a2', true, 2],
      ['a3', true, 2],
      ['a4', true, 1],
    ]);
    expect(await tasks.reassignStatus(randomUUID(), projectId, todo, doing, now)).toBe(0);
  });
});
