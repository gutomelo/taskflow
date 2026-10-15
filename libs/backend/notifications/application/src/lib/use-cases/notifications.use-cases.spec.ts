import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import type { NotificationFact } from '@taskflow/backend/notifications/domain';
import type { OrganizationRole } from '@taskflow/backend/shared/kernel';
import {
  createNotificationsTestbed,
  type NotificationsTestbed,
} from '../../testing/notifications-fakes';
import {
  NOTIFICATIONS_COUNT_POLICY,
  NOTIFICATIONS_PREFERENCE_POLICY,
} from '../shared/notifications-limits';
import {
  PlanDigestsUseCase,
  PurgeOldNotificationsUseCase,
  SendDigestUseCase,
} from './digest.use-cases';
import {
  CountUnreadUseCase,
  GetNotificationPreferenceUseCase,
  ListNotificationsUseCase,
  MarkAllReadUseCase,
  MarkReadUseCase,
  UpdateNotificationPreferenceUseCase,
} from './notification-queries.use-cases';
import { RecordNotificationsUseCase } from './record-notifications.use-case';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const [T1, T2, T3] = ['t-1', 't-2', 't-3'];
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 15, 11, minutes));

function world() {
  const bed = createNotificationsTestbed();
  for (const userId of ['ana', 'bia', 'caio', 'vivi']) {
    bed.notifications.members.add(`${ORG}|${userId}`);
    bed.people.join(ORG, userId, 'acme', userId === 'ana' ? 'owner' : 'member');
    bed.people.names.set(userId, userId.toUpperCase());
  }
  bed.notifications.members.add(`${OTHER_ORG}|bia`);
  bed.people.join(OTHER_ORG, 'bia', 'beta', 'member');
  for (const [taskId, organizationId, key] of [
    [T1, ORG, 'WEB-1'],
    [T2, ORG, 'WEB-2'],
    [T3, OTHER_ORG, 'APP-3'],
  ] as const) {
    bed.notifications.tasks.add(taskId);
    bed.targets.tasks.set(taskId, {
      organizationId,
      key,
      title: `Título ${key}`,
      readers: new Set(['bia', 'caio']),
    });
  }
  bed.people.addresses.set('bia', { email: 'bia@exemplo.com', name: 'Bia' });
  return bed;
}

let events = 0;
function fact(overrides: Partial<NotificationFact> = {}): NotificationFact {
  events += 1;
  return {
    kind: 'assignment',
    organizationId: ORG,
    projectId: 'p-web',
    taskId: T1,
    commentId: null,
    actorUserId: 'ana',
    recipientUserIds: ['bia'],
    sourceEventId: `e-${events}`,
    occurredAt: at(0),
    ...overrides,
  };
}
const mention = (commentId: string, overrides: Partial<NotificationFact> = {}) =>
  fact({ kind: 'mention', commentId, ...overrides });

const record = (bed: NotificationsTestbed, input: NotificationFact) =>
  new RecordNotificationsUseCase(bed).execute(input);

function as(
  userId: string,
  organizationId = ORG,
  role: OrganizationRole = 'member',
): TenantRequestContext {
  return {
    requestId: 'req-1',
    actor: { userId, sessionId: `s-${userId}` },
    tenant: { organizationId, organizationRole: role },
  };
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: { code?: string; message?: string }) => error.code ?? error.message,
  );

describe('RecordNotifications (BR-033, CA-01, CA-02, CA-03, CA-07)', () => {
  it('records one per recipient, never for the actor; reprocessing the event is a duplicate', async () => {
    const bed = world();
    const event = mention('c-1', { recipientUserIds: ['bia', 'ana', 'caio', 'bia'] });

    expect(await record(bed, event)).toEqual({
      created: 2,
      duplicate: 0,
      ineligible: 0,
      capped: 0,
    });
    expect(await record(bed, event)).toEqual({
      created: 0,
      duplicate: 2,
      ineligible: 0,
      capped: 0,
    });
    expect(
      bed.notifications.rows.map((row) => [row.recipientUserId, row.dedupeKey, row.commentId]),
    ).toEqual([
      ['bia', 'mention:c-1', 'c-1'],
      ['caio', 'mention:c-1', 'c-1'],
    ]);
  });

  it('D4: removing and re-adding a mention (a new event, same comment) does not notify again', async () => {
    const bed = world();
    await record(bed, mention('c-1'));
    expect(await record(bed, mention('c-1'))).toMatchObject({ created: 0, duplicate: 1 });
    expect(await record(bed, mention('c-2'))).toMatchObject({ created: 1 });
  });

  it('assigning to oneself notifies nobody; each assignment is a new fact', async () => {
    const bed = world();
    expect(await record(bed, fact({ recipientUserIds: ['ana'] }))).toMatchObject({ created: 0 });
    await record(bed, fact());
    await record(bed, fact());
    expect(bed.notifications.rows).toHaveLength(2);
  });

  it('B3: a recipient who left the organization is discarded without affecting the others', async () => {
    const bed = world();
    expect(await record(bed, mention('c-1', { recipientUserIds: ['gone', 'bia'] }))).toEqual({
      created: 1,
      duplicate: 0,
      ineligible: 1,
      capped: 0,
    });
  });

  it('decision 9: mentions are capped per actor and recipient per hour of occurrence; assignments are not', async () => {
    const bed = world();
    for (let index = 0; index < 20; index += 1) {
      await record(bed, mention(`c-${index}`, { occurredAt: at(30) }));
    }
    expect(await record(bed, mention('c-over', { occurredAt: at(40) }))).toMatchObject({
      capped: 1,
      created: 0,
    });
    expect(
      await record(bed, mention('c-other-actor', { actorUserId: 'caio', occurredAt: at(40) })),
    ).toMatchObject({
      created: 1,
    });
    // Uma hora depois do fato (não do processamento), o teto libera.
    expect(
      await record(
        bed,
        mention('c-later', { occurredAt: new Date(at(30).getTime() + 61 * 60_000) }),
      ),
    ).toMatchObject({ created: 1 });
    for (let index = 0; index < 30; index += 1) await record(bed, fact());
    expect(bed.notifications.rows.filter((row) => row.kind === 'assignment')).toHaveLength(30);
  });
});

describe('ListNotifications / CountUnread (CA-04, CA-05)', () => {
  async function seeded() {
    const bed = world();
    await record(bed, fact({ occurredAt: at(1) }));
    await record(bed, mention('c-1', { taskId: T2, occurredAt: at(2) }));
    bed.targets.mentions.add(`${ORG}|c-1|bia`);
    await record(bed, mention('c-gone', { occurredAt: at(3) }));
    await record(bed, fact({ organizationId: OTHER_ORG, taskId: T3, occurredAt: at(4) }));
    await record(bed, fact({ recipientUserIds: ['caio'], occurredAt: at(5) }));
    return bed;
  }

  it('only own notifications of the active organization, newest first, with names, keys and titles', async () => {
    const bed = await seeded();

    const page = await new ListNotificationsUseCase(bed).execute(as('bia'), {});

    expect(
      page.items.map((item) => [item.kind, item.task.key, item.task.title, item.actor]),
    ).toEqual([
      ['mention', 'WEB-2', 'Título WEB-2', { userId: 'ana', name: 'ANA' }],
      ['assignment', 'WEB-1', 'Título WEB-1', { userId: 'ana', name: 'ANA' }],
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('decision 6: a mention removed, a task no longer readable or an ex-member actor', async () => {
    const bed = await seeded();
    bed.targets.mentions.clear();
    bed.people.memberOf.delete(`${ORG}|ana`);
    bed.targets.tasks.get(T2)?.readers.delete('bia');

    const page = await new ListNotificationsUseCase(bed).execute(as('bia'), {});

    expect(page.items.map((item) => [item.task.key, item.actor.name])).toEqual([['WEB-1', null]]);
    expect(JSON.stringify(page)).not.toContain('Título WEB-2');
  });

  it('I4: pages may come short; the cursor continues; malformed cursors are 400', async () => {
    const bed = await seeded();
    const list = new ListNotificationsUseCase(bed);

    const first = await list.execute(as('bia'), { limit: 2 });
    const second = await list.execute(as('bia'), { limit: 2, cursor: first.nextCursor });

    expect(first.items.map((item) => item.task.key)).toEqual(['WEB-2']);
    expect(first.nextCursor).not.toBeNull();
    expect(second.items.map((item) => item.task.key)).toEqual(['WEB-1']);
    expect(second.nextCursor).toBeNull();
    expect(await code(list.execute(as('bia'), { cursor: 'lixo' }))).toBe('INVALID_CURSOR');
    const badDate = Buffer.from(
      JSON.stringify({ o: 'ontem', i: '0192a000-0000-7000-8000-000000000001' }),
    ).toString('base64url');
    expect(await code(list.execute(as('bia'), { cursor: badDate }))).toBe('INVALID_CURSOR');
  });

  it('counts visible unread; with none, no port is called', async () => {
    const bed = await seeded();
    const count = new CountUnreadUseCase(bed);

    expect(await count.execute(as('bia'))).toEqual({ count: 2, capped: false });
    bed.targets.calls.length = 0;
    expect(await count.execute(as('vivi'))).toEqual({ count: 0, capped: false });
    expect(bed.targets.calls).toEqual([]);
  });

  it('caps the counter at 99: exactly 99 is not capped, more is', async () => {
    const bed = world();
    for (let index = 0; index < 99; index += 1) await record(bed, fact());
    expect(await new CountUnreadUseCase(bed).execute(as('bia'))).toEqual({
      count: 99,
      capped: false,
    });
    for (let index = 0; index < 21; index += 1) await record(bed, fact());
    expect(await new CountUnreadUseCase(bed).execute(as('bia'))).toEqual({
      count: 99,
      capped: true,
    });
  });

  it('B4: a failing port propagates (never treated as visible)', async () => {
    const bed = await seeded();
    bed.targets.failWith = new Error('tasks down');
    expect(await code(new CountUnreadUseCase(bed).execute(as('bia')))).toBe('tasks down');
    expect(await code(new ListNotificationsUseCase(bed).execute(as('bia'), {}))).toBe('tasks down');
  });

  it('rate limited per user', async () => {
    const bed = await seeded();
    bed.rateLimiter.consumed.set(
      `${NOTIFICATIONS_COUNT_POLICY.name}|bia`,
      NOTIFICATIONS_COUNT_POLICY.points,
    );
    expect(await code(new CountUnreadUseCase(bed).execute(as('bia')))).toBe('RATE_LIMITED');
  });
});

describe('MarkRead / MarkAllRead (RF-06, CA-08)', () => {
  it("marks its own visible notification; someone else's, missing or invisible is the same 404", async () => {
    const bed = world();
    await record(bed, fact());
    await record(bed, fact({ recipientUserIds: ['caio'] }));
    await record(bed, mention('c-gone'));
    const [ofBia, ofCaio, invisible] = bed.notifications.rows;
    const markRead = new MarkReadUseCase(bed);

    expect(await code(markRead.execute(as('bia'), ofBia?.id ?? ''))).toBe('ok');
    expect(bed.notifications.rows[0]?.readAt).toEqual(bed.clock.now());
    for (const [actor, id, role] of [
      ['bia', ofCaio?.id, 'member'],
      ['ana', ofCaio?.id, 'owner'],
      ['bia', 'missing', 'member'],
      ['bia', invisible?.id, 'member'],
    ] as const) {
      expect(await code(markRead.execute(as(actor, ORG, role), id ?? ''))).toBe(
        'NOTIFICATION_NOT_FOUND',
      );
    }
    expect(bed.notifications.rows[1]?.readAt).toBeNull();
  });

  it("marks all up to the newest shown, never someone else's", async () => {
    const bed = world();
    await record(bed, fact({ occurredAt: at(1) }));
    await record(bed, fact({ occurredAt: at(2) }));
    await record(bed, fact({ occurredAt: at(3) }));
    await record(bed, fact({ recipientUserIds: ['caio'] }));
    const [older, middle, , ofCaio] = bed.notifications.rows;
    const markAll = new MarkAllReadUseCase(bed);

    await markAll.execute(as('bia'), { upToId: middle?.id });
    expect(bed.notifications.rows.map((row) => row.readAt !== null)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(await code(markAll.execute(as('bia'), { upToId: ofCaio?.id }))).toBe(
      'NOTIFICATION_NOT_FOUND',
    );
    await markAll.execute(as('bia'), {});
    expect(bed.notifications.rows.map((row) => row.readAt !== null)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(older?.id).toBeDefined();
  });
});

describe('preferences (RF-09)', () => {
  it('on by default; last write wins', async () => {
    const bed = world();
    expect(await new GetNotificationPreferenceUseCase(bed).execute('bia')).toEqual({
      emailDigest: true,
    });
    await new UpdateNotificationPreferenceUseCase(bed).execute('bia', { emailDigest: false });
    expect(await new GetNotificationPreferenceUseCase(bed).execute('bia')).toEqual({
      emailDigest: false,
    });
  });

  it('rate limited per user, reads and writes together (security audit B1)', async () => {
    const bed = world();
    bed.rateLimiter.consumed.set(
      `${NOTIFICATIONS_PREFERENCE_POLICY.name}|bia`,
      NOTIFICATIONS_PREFERENCE_POLICY.points,
    );
    expect(
      await code(
        new UpdateNotificationPreferenceUseCase(bed).execute('bia', { emailDigest: false }),
      ),
    ).toBe('RATE_LIMITED');
    expect(await code(new GetNotificationPreferenceUseCase(bed).execute('bia'))).toBe(
      'RATE_LIMITED',
    );
    expect(await bed.preferences.emailDigest('bia')).toBe(true);
    expect(await new GetNotificationPreferenceUseCase(bed).execute('caio')).toEqual({
      emailDigest: true,
    });
  });
});

describe('digest (BR-034, CA-06)', () => {
  const NOW = new Date(Date.UTC(2026, 9, 15, 12, 0));
  const send = (bed: NotificationsTestbed) => new SendDigestUseCase(bed).execute('bia', NOW);

  async function seeded() {
    const bed = world();
    await record(bed, fact({ occurredAt: at(10) }));
    await record(bed, mention('c-1', { taskId: T2, occurredAt: at(11) }));
    bed.targets.mentions.add(`${ORG}|c-1|bia`);
    await record(bed, mention('c-gone', { occurredAt: at(12) }));
    await record(bed, fact({ organizationId: OTHER_ORG, taskId: T3, occurredAt: at(13) }));
    // Fora da janela de 24 h (decisão 10).
    await record(bed, fact({ occurredAt: new Date(NOW.getTime() - 25 * 3_600_000) }));
    return bed;
  }

  it('plans only people with recent pending items and the preference on', async () => {
    const bed = await seeded();
    await record(bed, fact({ recipientUserIds: ['caio'], occurredAt: at(20) }));
    await bed.preferences.setEmailDigest('caio', false);
    expect(await new PlanDigestsUseCase(bed).execute(NOW)).toEqual(['bia']);
  });

  it('decision 8: counts, keys and links by slug — no names, titles nor texts; all candidates marked once', async () => {
    const bed = await seeded();

    expect(await send(bed)).toBe('sent');

    expect(bed.mailer.sent).toHaveLength(1);
    const [mail] = bed.mailer.sent;
    expect(mail?.to).toEqual({ email: 'bia@exemplo.com', name: 'Bia' });
    expect(mail?.digest).toEqual({
      groups: [
        {
          organizationSlug: 'acme',
          mentions: 1,
          assignments: 1,
          tasks: [
            { key: 'WEB-1', url: 'https://app.taskflow.test/o/acme/projects/WEB/tasks/1' },
            { key: 'WEB-2', url: 'https://app.taskflow.test/o/acme/projects/WEB/tasks/2' },
          ],
        },
        {
          organizationSlug: 'beta',
          mentions: 0,
          assignments: 1,
          tasks: [{ key: 'APP-3', url: 'https://app.taskflow.test/o/beta/projects/APP/tasks/3' }],
        },
      ],
      preferencesUrl: 'https://app.taskflow.test/account/notifications',
    });
    expect(JSON.stringify(mail?.digest)).not.toMatch(/Título|ANA/);
    const emailed = bed.notifications.rows.filter((row) => row.emailedAt !== null);
    expect(emailed).toHaveLength(4);
    expect(await send(bed)).toBe('empty');
  });

  it('preference off: nothing sent nor marked; no verified address or nothing visible: marked without sending', async () => {
    const bed = await seeded();
    await bed.preferences.setEmailDigest('bia', false);
    expect(await send(bed)).toBe('disabled');
    expect(bed.notifications.rows.every((row) => row.emailedAt === null)).toBe(true);

    await bed.preferences.setEmailDigest('bia', true);
    bed.people.addresses.delete('bia');
    expect(await send(bed)).toBe('no-address');
    expect(bed.mailer.sent).toEqual([]);
    expect(bed.notifications.rows.filter((row) => row.emailedAt !== null)).toHaveLength(4);

    const other = await seeded();
    for (const task of other.targets.tasks.values()) task.readers.clear();
    expect(await send(other)).toBe('nothing-visible');
    expect(other.notifications.rows.filter((row) => row.emailedAt !== null)).toHaveLength(4);
  });

  it('an organization the person left is skipped; a failed send marks nothing (retried)', async () => {
    const bed = await seeded();
    bed.people.memberOf.delete(`${OTHER_ORG}|bia`);
    bed.mailer.failNext = true;

    expect(await code(send(bed))).toBe('SMTP down');
    expect(bed.notifications.rows.every((row) => row.emailedAt === null)).toBe(true);
    expect(await send(bed)).toBe('sent');
    expect(bed.mailer.sent[0]?.digest.groups.map((group) => group.organizationSlug)).toEqual([
      'acme',
    ]);
  });
});

describe('retention (decision 5)', () => {
  it('purges notifications older than 90 days, batch after batch', async () => {
    const bed = world();
    const now = new Date(Date.UTC(2026, 9, 15));
    const old = new Date(now.getTime() - 91 * 86_400_000);
    for (let index = 0; index < 1_001; index += 1) await record(bed, fact({ occurredAt: old }));
    await record(bed, fact({ occurredAt: new Date(now.getTime() - 89 * 86_400_000) }));

    expect(await new PurgeOldNotificationsUseCase(bed).execute(now)).toBe(1_001);
    expect(bed.notifications.rows).toHaveLength(1);
  });
});
