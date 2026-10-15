import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';

/**
 * Restrições do banco da spec 008 (T2): FKs para a membership do destinatário e para a tarefa
 * (ADR 0015) com cascata, deduplicação por destinatário, CHECK de menção e índices parciais.
 */
describe('notifications schema (integration, T2)', () => {
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

  async function world() {
    const organizationId = randomUUID();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Acme',
        slug: `o-${organizationId.slice(0, 8)}`,
        createdAt: now,
      },
    });
    const member = async () => {
      const userId = randomUUID();
      await prisma.membership.create({
        data: { id: randomUUID(), organizationId, userId, role: 'member', createdAt: now },
      });
      return userId;
    };
    const projectId = randomUUID();
    await prisma.project.create({
      data: {
        id: projectId,
        organizationId,
        key: 'WEB',
        name: 'Web',
        createdByUserId: randomUUID(),
        createdAt: now,
      },
    });
    const statusId = randomUUID();
    await prisma.workflowStatus.create({
      data: {
        id: statusId,
        organizationId,
        projectId,
        name: 'A fazer',
        category: 'todo',
        position: 0,
      },
    });
    const task = async () => {
      next += 1;
      const created = await prisma.task.create({
        data: {
          id: randomUUID(),
          organizationId,
          projectId,
          number: next,
          title: `T${next}`,
          statusId,
          createdByUserId: randomUUID(),
          createdAt: now,
          boardRank: `e${String(next).padStart(5, '0')}`,
        },
      });
      return created.id;
    };
    return { organizationId, projectId, member, task };
  }

  function notification(
    target: { organizationId: string; projectId: string },
    recipientUserId: string,
    taskId: string,
    overrides: Partial<{
      kind: 'mention' | 'assignment';
      commentId: string | null;
      dedupeKey: string;
    }> = {},
  ) {
    const kind = overrides.kind ?? 'assignment';
    return prisma.notification.create({
      data: {
        id: randomUUID(),
        organizationId: target.organizationId,
        recipientUserId,
        kind,
        actorUserId: randomUUID(),
        projectId: target.projectId,
        taskId,
        commentId:
          overrides.commentId === undefined
            ? kind === 'mention'
              ? randomUUID()
              : null
            : overrides.commentId,
        dedupeKey: overrides.dedupeKey ?? `assignment:${randomUUID()}`,
        sourceEventId: randomUUID(),
        occurredAt: now,
        createdAt: now,
      },
    });
  }

  it('catalog: FKs cascade from the membership and the task, never update', async () => {
    const constraints = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE contype = 'f' AND conrelid = 'notifications'::regclass ORDER BY conname`;

    expect(constraints.map((constraint) => constraint.definition)).toEqual([
      'FOREIGN KEY (organization_id, project_id, task_id) REFERENCES tasks(organization_id, project_id, id) ON UPDATE RESTRICT ON DELETE CASCADE',
      'FOREIGN KEY (organization_id, recipient_user_id) REFERENCES memberships(organization_id, user_id) ON UPDATE RESTRICT ON DELETE CASCADE',
    ]);
  });

  it('catalog: partial indexes for the counter and the digest, written by hand', async () => {
    const indexes = await prisma.$queryRaw<Array<{ name: string; definition: string }>>`
      SELECT indexname AS name, indexdef AS definition FROM pg_indexes
      WHERE tablename = 'notifications' ORDER BY indexname`;
    const byName = new Map(indexes.map((index) => [index.name, index.definition]));

    expect(byName.get('notifications_unread_idx')).toMatch(
      /\(organization_id, recipient_user_id, occurred_at DESC\) INCLUDE \(task_id, comment_id, kind\) WHERE \(read_at IS NULL\)$/,
    );
    expect(byName.get('notifications_digest_idx')).toMatch(
      /\(recipient_user_id, occurred_at\) WHERE \(\(read_at IS NULL\) AND \(emailed_at IS NULL\)\)$/,
    );
    expect(byName.get('notifications_organization_id_project_id_task_id_idx')).toBeDefined();
  });

  it('only mentions point to a comment', async () => {
    const target = await world();
    const [bia, taskId] = [await target.member(), await target.task()];

    await expect(
      notification(target, bia, taskId, {
        kind: 'mention',
        commentId: null,
        dedupeKey: 'mention:x',
      }),
    ).rejects.toThrow();
    await expect(
      notification(target, bia, taskId, { kind: 'assignment', commentId: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      notification(target, bia, taskId, { kind: 'mention', dedupeKey: 'mention:y' }),
    ).resolves.toBeDefined();
  });

  it('dedupes per recipient; another recipient may share the key', async () => {
    const target = await world();
    const [bia, caio, taskId] = [await target.member(), await target.member(), await target.task()];

    await notification(target, bia, taskId, { dedupeKey: 'mention-like' });
    await expect(
      notification(target, bia, taskId, { dedupeKey: 'mention-like' }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      notification(target, caio, taskId, { dedupeKey: 'mention-like' }),
    ).resolves.toBeDefined();
  });

  it('only to members, about tasks of the same organization and project', async () => {
    const target = await world();
    const other = await world();
    const [bia, taskId, foreignTask] = [
      await target.member(),
      await target.task(),
      await other.task(),
    ];

    await expect(notification(target, randomUUID(), taskId)).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(notification(target, bia, foreignTask)).rejects.toMatchObject({ code: 'P2003' });
  });

  it('leaving the organization, deleting the task or the organization removes the notifications', async () => {
    const target = await world();
    const [bia, caio, t1, t2] = [
      await target.member(),
      await target.member(),
      await target.task(),
      await target.task(),
    ];
    await notification(target, bia, t1);
    await notification(target, caio, t1);
    await notification(target, caio, t2);

    await prisma.membership.deleteMany({
      where: { organizationId: target.organizationId, userId: bia },
    });
    expect(await prisma.notification.count()).toBe(2);
    await prisma.task.delete({ where: { id: t1 } });
    expect(await prisma.notification.count()).toBe(1);
    await prisma.organization.delete({ where: { id: target.organizationId } });
    expect(await prisma.notification.count()).toBe(0);
  });
});
