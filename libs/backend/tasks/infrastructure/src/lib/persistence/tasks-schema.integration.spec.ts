import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';

/**
 * Restrições do banco da spec 004 (T2): CHECKs, FKs compostas (mesmo projeto) e as FKs entre
 * contextos do ADR 0015 — inclusive o `SET NULL (assignee_user_id)` escrito à mão, que o Prisma
 * não enxerga (teste de catálogo).
 */
describe('tasks schema (integration, T2)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  const now = new Date();

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE organizations CASCADE`;
  });

  async function world() {
    const organizationId = randomUUID();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Acme',
        slug: `org-${organizationId.slice(0, 8)}`,
        createdAt: now,
      },
    });
    const project = async (key: string) => {
      const id = randomUUID();
      await prisma.project.create({
        data: { id, organizationId, key, name: key, createdByUserId: randomUUID(), createdAt: now },
      });
      const statusId = randomUUID();
      await prisma.workflowStatus.create({
        data: {
          id: statusId,
          organizationId,
          projectId: id,
          name: 'A fazer',
          category: 'todo',
          position: 0,
        },
      });
      return { id, statusId };
    };
    const userId = randomUUID();
    await prisma.membership.create({
      data: { id: randomUUID(), organizationId, userId, role: 'member', createdAt: now },
    });
    return { organizationId, userId, p1: await project('WEB'), p2: await project('APP') };
  }

  let next = 0;
  function task(
    organizationId: string,
    project: { id: string; statusId: string },
    overrides: Partial<{
      number: number;
      parentTaskId: string;
      isRequired: boolean;
      assigneeUserId: string;
      title: string;
      statusId: string;
      boardRank: string;
    }> = {},
  ) {
    next += 1;
    return prisma.task.create({
      data: {
        id: randomUUID(),
        organizationId,
        projectId: project.id,
        number: overrides.number ?? next,
        title: overrides.title ?? `Tarefa ${next}`,
        statusId: overrides.statusId ?? project.statusId,
        parentTaskId: overrides.parentTaskId ?? null,
        isRequired: overrides.isRequired ?? false,
        assigneeUserId: overrides.assigneeUserId ?? null,
        createdByUserId: randomUUID(),
        createdAt: now,
        boardRank: overrides.boardRank ?? `e${String(next).padStart(5, '0')}`,
      },
    });
  }

  it('catalog: the assignee FK sets only assignee_user_id to null (Prisma cannot express it)', async () => {
    const [constraint] = await prisma.$queryRaw<Array<{ deltype: string; columns: string[] }>>`
      SELECT c.confdeltype::text AS deltype,
             ARRAY(SELECT a.attname::text FROM unnest(c.confdelsetcols) AS k(attnum)
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns
      FROM pg_constraint c WHERE c.conname = 'tasks_organization_id_assignee_user_id_fkey'`;

    expect(constraint).toEqual({ deltype: 'n', columns: ['assignee_user_id'] });
  });

  describe('spec 005 (T3): board rank and editable workflow', () => {
    it('catalog: board_rank compares in ASCII (COLLATE "C", Prisma cannot express it)', async () => {
      const [column] = await prisma.$queryRaw<Array<{ collation: string | null }>>`
        SELECT collation_name AS collation FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'board_rank'`;

      expect(column?.collation).toBe('C');
    });

    it('catalog: the column index is not unique and replaces the status index; status names are unique without case', async () => {
      const indexes = await prisma.$queryRaw<Array<{ name: string; definition: string }>>`
        SELECT indexname AS name, indexdef AS definition FROM pg_indexes
        WHERE tablename IN ('tasks', 'workflow_statuses') ORDER BY indexname`;
      const byName = new Map(indexes.map((index) => [index.name, index.definition]));

      expect(byName.get('tasks_organization_id_project_id_status_id_board_rank_id_idx')).toMatch(
        /^CREATE INDEX .*\(organization_id, project_id, status_id, board_rank, id\)$/,
      );
      expect(byName.has('tasks_organization_id_project_id_status_id_idx')).toBe(false);
      expect(byName.get('workflow_statuses_organization_id_project_id_lower_name_key')).toMatch(
        /^CREATE UNIQUE INDEX .*\(organization_id, project_id, lower\(\(name\)::text\)\)$/,
      );
    });

    it('ordering follows code units: uppercase before lowercase, like the domain', async () => {
      const { organizationId, p1 } = await world();
      for (const boardRank of ['ab', 'aB', 'a0', 'aZ', 'aa'])
        await task(organizationId, p1, { boardRank });

      const rows = await prisma.task.findMany({
        where: { organizationId, projectId: p1.id },
        orderBy: [{ boardRank: 'asc' }, { id: 'asc' }],
        select: { boardRank: true },
      });

      expect(rows.map((row) => row.boardRank)).toEqual(['a0', 'aB', 'aZ', 'aa', 'ab']);
    });

    it('CHECK: rank alphabet and length; ties are allowed (the index is not unique)', async () => {
      const { organizationId, p1 } = await world();
      for (const boardRank of ['a_1', '0a', 'a', `a${'1'.repeat(64)}`]) {
        await expect(task(organizationId, p1, { boardRank }), boardRank).rejects.toThrow();
      }
      await task(organizationId, p1, { boardRank: 'a5' });
      await expect(task(organizationId, p1, { boardRank: 'a5' })).resolves.toBeDefined();
    });

    it('BR-030: status names are unique per project without case; workflow_version starts at 1', async () => {
      const { organizationId, p1, p2 } = await world();
      const status = (projectId: string, name: string) =>
        prisma.workflowStatus.create({
          data: {
            id: randomUUID(),
            organizationId,
            projectId,
            name,
            category: 'todo',
            position: 1,
          },
        });

      await expect(status(p1.id, 'A FAZER')).rejects.toThrow();
      await expect(status(p2.id, 'Revisão')).resolves.toBeDefined();
      await expect(status(p1.id, 'Revisão')).resolves.toBeDefined();
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: p1.id },
        select: { workflowVersion: true },
      });
      expect(project.workflowVersion).toBe(1);
    });
  });

  it('BR-003: removing the membership unassigns the tasks and keeps the organization', async () => {
    const { organizationId, userId, p1 } = await world();
    const created = await task(organizationId, p1, { assigneeUserId: userId });

    await prisma.membership.deleteMany({ where: { organizationId, userId } });

    expect(await prisma.task.findUnique({ where: { id: created.id } })).toMatchObject({
      organizationId,
      assigneeUserId: null,
    });
  });

  it('only members of the organization can be assignees', async () => {
    const { organizationId, p1 } = await world();

    await expect(task(organizationId, p1, { assigneeUserId: randomUUID() })).rejects.toMatchObject({
      code: 'P2003',
    });
  });

  it('BR-028: numbers are unique per project and positive', async () => {
    const { organizationId, p1, p2 } = await world();
    await task(organizationId, p1, { number: 1 });

    await expect(task(organizationId, p1, { number: 1 })).rejects.toMatchObject({ code: 'P2002' });
    await expect(task(organizationId, p2, { number: 1 })).resolves.toBeDefined();
    await expect(task(organizationId, p2, { number: 0 })).rejects.toThrow(/tasks_number_positive/);
  });

  it('parent, status and dependencies must belong to the same project', async () => {
    const { organizationId, p1, p2 } = await world();
    const inP2 = await task(organizationId, p2);
    const inP1 = await task(organizationId, p1);

    await expect(task(organizationId, p1, { parentTaskId: inP2.id })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(task(organizationId, p1, { statusId: p2.statusId })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(
      prisma.taskDependency.create({
        data: {
          organizationId,
          projectId: p1.id,
          blockedTaskId: inP1.id,
          blockingTaskId: inP2.id,
          createdAt: now,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.taskDependency.create({
        data: {
          organizationId,
          projectId: p1.id,
          blockedTaskId: inP1.id,
          blockingTaskId: inP1.id,
          createdAt: now,
        },
      }),
    ).rejects.toThrow(/task_dependencies_distinct_tasks/);
  });

  it('CHECKs: required only for subtasks, normalized title, completion and cancellation pairs', async () => {
    const { organizationId, p1 } = await world();

    await expect(task(organizationId, p1, { isRequired: true })).rejects.toThrow(
      /tasks_required_only_for_subtasks/,
    );
    await expect(task(organizationId, p1, { title: ' x ' })).rejects.toThrow(
      /tasks_title_normalized/,
    );
    const created = await task(organizationId, p1);
    await expect(
      prisma.task.update({ where: { id: created.id }, data: { completedAt: now } }),
    ).rejects.toThrow(/tasks_completion_consistent/);
    await expect(
      prisma.task.update({ where: { id: created.id }, data: { canceledAt: now } }),
    ).rejects.toThrow(/tasks_cancellation_consistent/);
  });

  it('a status in use cannot be deleted (RESTRICT; spec 005 migrates tasks first)', async () => {
    const { organizationId, p1 } = await world();
    await task(organizationId, p1);

    await expect(prisma.workflowStatus.delete({ where: { id: p1.statusId } })).rejects.toThrow();
  });

  it('deleting a task removes its subtasks and dependencies; deleting the organization removes everything', async () => {
    const { organizationId, p1 } = await world();
    const parent = await task(organizationId, p1);
    const child = await task(organizationId, p1, { parentTaskId: parent.id, isRequired: true });
    const other = await task(organizationId, p1);
    await prisma.taskDependency.create({
      data: {
        organizationId,
        projectId: p1.id,
        blockedTaskId: other.id,
        blockingTaskId: child.id,
        createdAt: now,
      },
    });
    await prisma.taskCounter.create({ data: { organizationId, projectId: p1.id, nextNumber: 10 } });
    await prisma.taskProjectLock.create({ data: { organizationId, projectId: p1.id } });

    await prisma.task.delete({ where: { id: parent.id } });
    expect(await prisma.task.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.taskDependency.count()).toBe(0);

    await prisma.organization.delete({ where: { id: organizationId } });
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.taskCounter.count()).toBe(0);
    expect(await prisma.taskProjectLock.count()).toBe(0);
  });
});
