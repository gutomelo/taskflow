import { randomUUID } from 'node:crypto';
import type { NewNotification } from '@taskflow/backend/notifications/domain';
import {
  createPrismaClient,
  PrismaTransactionRunner,
  type PrismaClient,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import {
  PrismaNotificationPreferenceRepository,
  PrismaNotificationRepository,
} from './prisma-notification.repository';

describe('notifications persistence (integration, T3)', () => {
  let database: PostgresTestDatabase;
  let prisma: PrismaClient;
  let notifications: PrismaNotificationRepository;
  let preferences: PrismaNotificationPreferenceRepository;
  const t0 = new Date('2026-10-15T10:00:00.000Z');
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    const transactions = new PrismaTransactionRunner(prisma);
    notifications = new PrismaNotificationRepository(transactions);
    preferences = new PrismaNotificationPreferenceRepository(transactions);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.stop();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE organizations, notification_preferences CASCADE`;
  });

  let next = 0;

  /** Organização com ana (ator), bia e caio (destinatários) e duas tarefas. */
  async function world() {
    const organizationId = randomUUID();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Acme',
        slug: `o-${organizationId.slice(0, 8)}`,
        createdAt: t0,
      },
    });
    const [ana, bia, caio] = [randomUUID(), randomUUID(), randomUUID()];
    for (const userId of [ana, bia, caio]) {
      await prisma.membership.create({
        data: { id: randomUUID(), organizationId, userId, role: 'member', createdAt: t0 },
      });
    }
    const projectId = randomUUID();
    await prisma.project.create({
      data: {
        id: projectId,
        organizationId,
        key: 'WEB',
        name: 'Web',
        createdByUserId: ana,
        createdAt: t0,
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
      return (
        await prisma.task.create({
          data: {
            id: randomUUID(),
            organizationId,
            projectId,
            number: next,
            title: `T${next}`,
            statusId,
            createdByUserId: ana,
            createdAt: t0,
            boardRank: `e${String(next).padStart(5, '0')}`,
          },
        })
      ).id;
    };
    const tasks = [await task(), await task()] as const;
    const build = (overrides: Partial<NewNotification> = {}): NewNotification => {
      const sourceEventId = randomUUID();
      return {
        id: randomUUID(),
        organizationId,
        recipientUserId: bia,
        kind: 'assignment',
        actorUserId: ana,
        projectId,
        taskId: tasks[0],
        commentId: null,
        dedupeKey: `assignment:${sourceEventId}`,
        sourceEventId,
        occurredAt: t0,
        createdAt: t0,
        ...overrides,
      };
    };
    return { organizationId, ana, bia, caio, tasks, build };
  }

  it('inserts once per key; a member who left or a deleted task is ineligible, never an error', async () => {
    const { organizationId, bia, tasks, build } = await world();
    const first = build({ kind: 'mention', commentId: randomUUID(), dedupeKey: 'mention:c-1' });

    expect(await notifications.insert(first)).toBe('created');
    expect(await notifications.insert({ ...first, id: randomUUID() })).toBe('duplicate');
    expect(await notifications.insert(build({ recipientUserId: randomUUID() }))).toBe('ineligible');
    await prisma.task.delete({ where: { id: tasks[1] } });
    expect(await notifications.insert(build({ taskId: tasks[1] }))).toBe('ineligible');
    expect(
      await prisma.notification.count({ where: { organizationId, recipientUserId: bia } }),
    ).toBe(1);
  });

  it('pages newest first by (occurred_at, id), only the recipient in the organization', async () => {
    const a = await world();
    const b = await world();
    const ids: string[] = [];
    for (const minutes of [0, 1, 1, 2]) {
      const created = a.build({ occurredAt: at(minutes) });
      ids.push(created.id);
      await notifications.insert(created);
    }
    await notifications.insert(a.build({ recipientUserId: a.caio }));
    await notifications.insert(b.build());
    const tied = [ids[1], ids[2]].sort().reverse();

    const first = await notifications.page(a.organizationId, a.bia, 2, null);
    const last = first.at(-1);
    const second = await notifications.page(
      a.organizationId,
      a.bia,
      10,
      last ? { occurredAt: last.occurredAt, id: last.id } : null,
    );

    expect(first.map((row) => row.id)).toEqual([ids[3], tied[0]]);
    expect(second.map((row) => row.id)).toEqual([tied[1], ids[0]]);
    expect(await notifications.page(b.organizationId, a.bia, 10, null)).toEqual([]);
  });

  it('marks read only its own; mark all respects the limit and other recipients', async () => {
    const { organizationId, bia, caio, build } = await world();
    const older = build({ occurredAt: at(0) });
    const newer = build({ occurredAt: at(5) });
    const ofCaio = build({ recipientUserId: caio });
    for (const row of [older, newer, ofCaio]) await notifications.insert(row);

    await notifications.markRead(organizationId, caio, older.id, at(10));
    expect((await notifications.findOwn(organizationId, bia, older.id))?.readAt).toBeNull();
    expect(await notifications.findOwn(organizationId, caio, older.id)).toBeNull();

    expect(
      await notifications.markAllRead(
        organizationId,
        bia,
        { occurredAt: older.occurredAt, id: older.id },
        at(10),
      ),
    ).toBe(1);
    expect(
      (await notifications.recentUnread(organizationId, bia, 10)).map((row) => row.id),
    ).toEqual([newer.id]);
    expect(await notifications.markAllRead(organizationId, bia, null, at(11))).toBe(1);
    expect((await notifications.findOwn(organizationId, caio, ofCaio.id))?.readAt).toBeNull();
  });

  it('counts mentions of an actor to a recipient since a moment, by occurred_at', async () => {
    const { organizationId, ana, bia, caio, build } = await world();
    for (const [minutes, recipient, kind] of [
      [0, bia, 'mention'],
      [30, bia, 'mention'],
      [31, bia, 'assignment'],
      [32, caio, 'mention'],
    ] as const) {
      await notifications.insert(
        build({
          recipientUserId: recipient,
          kind,
          occurredAt: at(minutes),
          commentId: kind === 'mention' ? randomUUID() : null,
          dedupeKey: `${kind}:${randomUUID()}`,
        }),
      );
    }
    // Menção de outra pessoa (caio) para bia não entra na conta de ana.
    await notifications.insert(
      build({
        actorUserId: caio,
        kind: 'mention',
        occurredAt: at(40),
        commentId: randomUUID(),
        dedupeKey: `mention:${randomUUID()}`,
      }),
    );
    expect(await notifications.countMentionsSince(organizationId, ana, bia, at(10))).toBe(1);
    expect(await notifications.countMentionsSince(organizationId, ana, bia, at(0))).toBe(2);
    expect(await notifications.countMentionsSince(randomUUID(), ana, bia, at(0))).toBe(0);
  });

  it('digest: recipients with recent pending items and the preference on; candidates; emailed once', async () => {
    const a = await world();
    const b = await world();
    const recent = a.build({ occurredAt: at(60) });
    const old = a.build({ occurredAt: at(0) });
    const read = a.build({ occurredAt: at(60), recipientUserId: a.caio });
    const otherOrg = b.build({ occurredAt: at(61), recipientUserId: a.bia });
    for (const row of [recent, old, read]) await notifications.insert(row);
    await prisma.membership.create({
      data: {
        id: randomUUID(),
        organizationId: b.organizationId,
        userId: a.bia,
        role: 'member',
        createdAt: t0,
      },
    });
    await notifications.insert(otherOrg);
    await notifications.markRead(a.organizationId, a.caio, read.id, at(61));
    await preferences.setEmailDigest(b.bia, false, t0);
    await notifications.insert(b.build({ occurredAt: at(60) }));
    // Pendência só antiga (fora da janela): caio não entra no fan-out.
    await notifications.insert(a.build({ recipientUserId: a.caio, occurredAt: at(0) }));

    expect(await notifications.digestRecipients(at(30))).toEqual([a.bia]);
    const candidates = await notifications.digestCandidates(a.bia, at(30), 10);
    expect(candidates.map((row) => row.id)).toEqual([recent.id, otherOrg.id]);

    await notifications.markEmailed(a.bia, [recent.id], at(70));
    await notifications.markEmailed(a.bia, [recent.id], at(80));
    expect((await notifications.findOwn(a.organizationId, a.bia, recent.id))?.emailedAt).toEqual(
      at(70),
    );
    await notifications.markEmailed(a.caio, [otherOrg.id], at(80));
    expect((await notifications.digestCandidates(a.bia, at(30), 10)).map((row) => row.id)).toEqual([
      otherOrg.id,
    ]);
  });

  it('purges notifications older than the cutoff, in batches', async () => {
    const { build } = await world();
    for (const minutes of [0, 1, 2, 100])
      await notifications.insert(build({ occurredAt: at(minutes) }));

    expect(await notifications.purgeBefore(at(50), 2)).toBe(2);
    expect(await notifications.purgeBefore(at(50), 2)).toBe(1);
    expect(await notifications.purgeBefore(at(50), 2)).toBe(0);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('preference: on by default, last write wins', async () => {
    const userId = randomUUID();
    expect(await preferences.emailDigest(userId)).toBe(true);
    await preferences.setEmailDigest(userId, false, t0);
    expect(await preferences.emailDigest(userId)).toBe(false);
    await preferences.setEmailDigest(userId, true, at(1));
    expect(await preferences.emailDigest(userId)).toBe(true);
  });
});
