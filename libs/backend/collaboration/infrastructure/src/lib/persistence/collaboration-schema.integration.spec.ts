import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';

/**
 * Restrições do banco da spec 010 (T2): FK composta para a tarefa (ADR 0015) com cascata, menções
 * presas ao comentário da mesma organização e os CHECKs escritos à mão na migration.
 */
describe('collaboration schema (integration, T2)', () => {
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

  let next = 0;

  async function organization() {
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
    const task = async (
      project: { id: string; statusId: string },
      parentTaskId: string | null = null,
    ) => {
      next += 1;
      return prisma.task.create({
        data: {
          id: randomUUID(),
          organizationId,
          projectId: project.id,
          number: next,
          title: `Tarefa ${next}`,
          statusId: project.statusId,
          parentTaskId,
          createdByUserId: randomUUID(),
          createdAt: now,
          boardRank: `e${String(next).padStart(5, '0')}`,
        },
      });
    };
    return { organizationId, project, task };
  }

  function comment(
    target: { organizationId: string; projectId: string; id: string },
    overrides: Partial<{ body: string | null; deletedAt: Date | null; projectId: string }> = {},
  ) {
    return prisma.comment.create({
      data: {
        id: randomUUID(),
        organizationId: target.organizationId,
        projectId: overrides.projectId ?? target.projectId,
        taskId: target.id,
        authorUserId: randomUUID(),
        body: overrides.body === undefined ? 'Pode revisar?' : overrides.body,
        deletedAt: overrides.deletedAt ?? null,
        createdAt: now,
      },
    });
  }

  it('catalog: FKs cascade from the task and the comment, never update', async () => {
    const constraints = await prisma.$queryRaw<
      Array<{ name: string; deltype: string; updtype: string; definition: string }>
    >`
      SELECT conname AS name, confdeltype::text AS deltype, confupdtype::text AS updtype,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE contype = 'f' AND conrelid IN ('comments'::regclass, 'comment_mentions'::regclass)
      ORDER BY conname`;

    expect(constraints).toEqual([
      {
        name: 'comment_mentions_organization_id_comment_id_fkey',
        deltype: 'c',
        updtype: 'r',
        definition:
          'FOREIGN KEY (organization_id, comment_id) REFERENCES comments(organization_id, id) ON UPDATE RESTRICT ON DELETE CASCADE',
      },
      {
        name: 'comments_organization_id_project_id_task_id_fkey',
        deltype: 'c',
        updtype: 'r',
        definition:
          'FOREIGN KEY (organization_id, project_id, task_id) REFERENCES tasks(organization_id, project_id, id) ON UPDATE RESTRICT ON DELETE CASCADE',
      },
    ]);
  });

  it('catalog: CHECKs written by hand and indexes starting with the organization', async () => {
    const checks = await prisma.$queryRaw<Array<{ name: string; definition: string }>>`
      SELECT conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE contype = 'c' AND conrelid = 'comments'::regclass ORDER BY conname`;
    const indexes = await prisma.$queryRaw<Array<{ name: string; definition: string }>>`
      SELECT indexname AS name, indexdef AS definition FROM pg_indexes
      WHERE tablename IN ('comments', 'comment_mentions') ORDER BY indexname`;

    expect(checks.map((check) => check.name)).toEqual([
      'comments_body_length_check',
      'comments_deleted_body_check',
    ]);
    const byName = new Map(indexes.map((index) => [index.name, index.definition]));
    expect(byName.get('comments_organization_id_task_id_created_at_id_idx')).toMatch(
      /\(organization_id, task_id, created_at DESC, id DESC\)$/,
    );
    expect(byName.get('comment_mentions_organization_id_user_id_idx')).toMatch(
      /\(organization_id, user_id\)$/,
    );
    expect(byName.get('comment_mentions_pkey')).toMatch(
      /\(organization_id, comment_id, user_id\)$/,
    );
  });

  it('D4: text is null exactly when removed', async () => {
    const { project, task } = await organization();
    const target = await task(await project('WEB'));

    await expect(comment(target, { body: null })).rejects.toThrow();
    await expect(comment(target, { deletedAt: now })).rejects.toThrow();
    await expect(comment(target, { body: null, deletedAt: now })).resolves.toBeDefined();
  });

  it('BR-031: 1 to 5 000 characters, counted in code points', async () => {
    const { project, task } = await organization();
    const target = await task(await project('WEB'));

    await expect(comment(target, { body: '' })).rejects.toThrow();
    await expect(comment(target, { body: 'a'.repeat(5001) })).rejects.toThrow();
    await expect(comment(target, { body: '😀'.repeat(5000) })).resolves.toBeDefined();
  });

  it('ADR 0015: a comment belongs to a task of the same project and organization', async () => {
    const a = await organization();
    const b = await organization();
    const web = await a.project('WEB');
    const app = await a.project('APP');
    const target = await a.task(web);

    await expect(comment(target, { projectId: app.id })).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      comment({ organizationId: b.organizationId, projectId: web.id, id: target.id }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('mentions belong to a comment of the same organization and never repeat', async () => {
    const a = await organization();
    const b = await organization();
    const created = await comment(await a.task(await a.project('WEB')));
    const userId = randomUUID();
    const mention = (organizationId: string) =>
      prisma.commentMention.create({ data: { organizationId, commentId: created.id, userId } });

    await expect(mention(b.organizationId)).rejects.toMatchObject({ code: 'P2003' });
    await mention(a.organizationId);
    await expect(mention(a.organizationId)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('RF-10: deleting a task (with subtasks) or the organization removes comments and mentions', async () => {
    const { organizationId, project, task } = await organization();
    const web = await project('WEB');
    const parent = await task(web);
    const subtask = await task(web, parent.id);
    const other = await task(web);
    const onParent = await comment(parent);
    await comment(subtask);
    const kept = await comment(other);
    await prisma.commentMention.create({
      data: { organizationId, commentId: onParent.id, userId: randomUUID() },
    });

    await prisma.task.delete({ where: { id: parent.id } });

    expect(await prisma.comment.findMany({ select: { id: true } })).toEqual([{ id: kept.id }]);
    expect(await prisma.commentMention.count()).toBe(0);

    await prisma.organization.delete({ where: { id: organizationId } });
    expect(await prisma.comment.count()).toBe(0);
  });
});
