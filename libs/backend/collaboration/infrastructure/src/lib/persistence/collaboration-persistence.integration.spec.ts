import { randomUUID } from 'node:crypto';
import { Comment, parseCommentBody } from '@taskflow/backend/collaboration/domain';
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
import { PrismaCommentRepository } from './prisma-comment.repository';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('collaboration persistence (integration, T3)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRunner;
  let comments: PrismaCommentRepository;
  const now = new Date('2026-10-14T10:00:00.000Z');
  const author = randomUUID();
  const [bia, vivi, otto] = [randomUUID(), randomUUID(), randomUUID()];

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    transactions = new PrismaTransactionRunner(prisma, { timeoutMs: 10_000 });
    comments = new PrismaCommentRepository(transactions);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE organizations CASCADE`;
  });

  let next = 0;

  /** Organização com um projeto e duas tarefas (semeadas direto: tabelas de outros contextos). */
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
    const projectId = randomUUID();
    await prisma.project.create({
      data: {
        id: projectId,
        organizationId,
        key: 'WEB',
        name: 'Web',
        createdByUserId: author,
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
          title: `Tarefa ${next}`,
          statusId,
          createdByUserId: author,
          createdAt: now,
          boardRank: `e${String(next).padStart(5, '0')}`,
        },
      });
      return created.id;
    };
    return { organizationId, projectId, taskA: await task(), taskB: await task() };
  }

  function newComment(
    target: { organizationId: string; projectId: string },
    taskId: string,
    raw: string,
    createdAt = now,
  ) {
    return Comment.create({
      id: randomUUID(),
      organizationId: target.organizationId,
      projectId: target.projectId,
      taskId,
      authorUserId: author,
      content: parseCommentBody(raw, author),
      now: createdAt,
    });
  }

  it('adds and finds a comment with its mentions, only within its organization', async () => {
    const a = await world();
    const b = await world();
    const comment = newComment(a, a.taskA, `Oi <@${bia}> e <@${vivi}>`);

    await comments.add(comment);

    const found = await comments.findById(a.organizationId, comment.id);
    expect(found?.snapshot()).toMatchObject({
      body: `Oi <@${bia}> e <@${vivi}>`,
      version: 1,
      deletedAt: null,
    });
    expect([...(found?.mentionedUserIds ?? [])].sort()).toEqual([bia, vivi].sort());
    expect(await comments.findById(b.organizationId, comment.id)).toBeNull();
  });

  it('pages a task conversation by (created_at DESC, id DESC), ties by id, only that task', async () => {
    const a = await world();
    const later = new Date('2026-10-14T11:00:00.000Z');
    const tied = [newComment(a, a.taskA, 'um'), newComment(a, a.taskA, 'dois')];
    const newest = newComment(a, a.taskA, 'três', later);
    for (const comment of [...tied, newest, newComment(a, a.taskB, 'outra tarefa')]) {
      await comments.add(comment);
    }
    const tiedByIdDesc = tied
      .map((comment) => comment.id)
      .sort()
      .reverse();

    const first = await comments.page(a.organizationId, a.taskA, 2, null);
    const last = first.at(-1)?.snapshot();
    const second = await comments.page(
      a.organizationId,
      a.taskA,
      2,
      last ? { createdAt: last.createdAt, id: last.id } : null,
    );

    expect(first.map((comment) => comment.id)).toEqual([newest.id, tiedByIdDesc[0]]);
    expect(second.map((comment) => comment.id)).toEqual([tiedByIdDesc[1]]);
    expect(await comments.page(randomUUID(), a.taskA, 10, null)).toEqual([]);
  });

  it('saves an edit with the version, replacing the mentions; a stale version is a conflict', async () => {
    const a = await world();
    const comment = newComment(a, a.taskA, `<@${bia}> <@${vivi}>`);
    await comments.add(comment);

    await transactions.run(async () => {
      const locked = await comments.lockById(a.organizationId, comment.id);
      locked?.edit(parseCommentBody(`<@${vivi}> <@${otto}>`, author), now);
      if (locked) await comments.save(locked);
    });

    const saved = await comments.findById(a.organizationId, comment.id);
    expect(saved?.version).toBe(2);
    expect([...(saved?.mentionedUserIds ?? [])].sort()).toEqual([vivi, otto].sort());
    // `comment` ainda está na versão 1.
    comment.edit(parseCommentBody('outra', author), now);
    await expect(comments.save(comment)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('a removed comment keeps its row without text nor mentions and leaves the active count', async () => {
    const a = await world();
    const removed = newComment(a, a.taskA, `<@${bia}>`);
    await comments.add(removed);
    await comments.add(newComment(a, a.taskA, 'fica'));
    await comments.add(newComment(a, a.taskB, 'outra tarefa'));

    removed.delete(otto, now);
    await comments.save(removed);

    expect((await comments.findById(a.organizationId, removed.id))?.snapshot()).toMatchObject({
      body: null,
      mentionedUserIds: [],
      deletedByUserId: otto,
      version: 2,
    });
    expect(await prisma.commentMention.count()).toBe(0);
    expect(await comments.countActive(a.organizationId, a.taskA)).toBe(1);
    expect(await comments.countActive(randomUUID(), a.taskA)).toBe(0);
  });

  it('a save never touches another organization', async () => {
    const a = await world();
    const b = await world();
    const comment = newComment(a, a.taskA, 'texto');
    await comments.add(comment);
    const forged = Comment.restore({ ...comment.snapshot(), organizationId: b.organizationId });
    forged.edit(parseCommentBody('invadido', author), now);

    await expect(comments.save(forged)).rejects.toBeInstanceOf(VersionConflictError);
    expect((await comments.findById(a.organizationId, comment.id))?.snapshot().body).toBe('texto');
  });

  it('locks a comment row only inside a transaction, serializing writers', async () => {
    const a = await world();
    const comment = newComment(a, a.taskA, 'texto');
    await comments.add(comment);
    await expect(comments.lockById(a.organizationId, comment.id)).rejects.toBeInstanceOf(
      TransactionRequiredError,
    );
    expect(await transactions.run(() => comments.lockById(randomUUID(), comment.id))).toBeNull();

    const order: string[] = [];
    const first = transactions.run(async () => {
      await comments.lockById(a.organizationId, comment.id);
      order.push('first locked');
      await sleep(300);
      order.push('first done');
    });
    await sleep(50);
    const second = transactions.run(async () => {
      await comments.lockById(a.organizationId, comment.id);
      order.push('second locked');
    });
    await Promise.all([first, second]);

    expect(order).toEqual(['first locked', 'first done', 'second locked']);
  });

  it('spec 008: active mentions only in a comment not removed of the given task, in the organization', async () => {
    const a = await world();
    const kept = newComment(a, a.taskA, `oi <@${bia}> <@${vivi}>`);
    const removed = newComment(a, a.taskA, `oi <@${otto}>`);
    await comments.add(kept);
    await comments.add(removed);
    removed.delete(author, now);
    await comments.save(removed);

    const active = await comments.activeMentions(a.organizationId, [
      { taskId: a.taskA, commentId: kept.id, userId: bia },
      { taskId: a.taskB, commentId: kept.id, userId: vivi },
      { taskId: a.taskA, commentId: kept.id, userId: otto },
      { taskId: a.taskA, commentId: removed.id, userId: otto },
    ]);

    expect([...active]).toEqual([`${kept.id}|${bia}`]);
    expect(
      await comments.activeMentions(randomUUID(), [
        { taskId: a.taskA, commentId: kept.id, userId: bia },
      ]),
    ).toEqual(new Set());
    expect(await comments.activeMentions(a.organizationId, [])).toEqual(new Set());
  });
});
