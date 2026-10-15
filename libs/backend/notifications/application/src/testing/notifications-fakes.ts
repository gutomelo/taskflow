// Fakes em memória para os testes de casos de uso de `notifications`. Nunca em produção.
import type {
  InsertOutcome,
  NewNotification,
  NotificationPosition,
  NotificationPreferenceRepository,
  NotificationRecord,
  NotificationRepository,
} from '@taskflow/backend/notifications/domain';
import {
  FixedClock,
  InMemoryRateLimiter,
  SequentialIds,
} from '@taskflow/backend/shared/application/testing';
import type { OrganizationRole } from '@taskflow/backend/shared/kernel';
import type { DigestEmail, DigestMailer } from '../lib/ports/digest-mailer';
import type {
  DigestAddress,
  NotificationPeople,
  OrganizationMembership,
} from '../lib/ports/notification-people';
import {
  activeMentionKey,
  type MentionReference,
  type NotificationTargets,
  type Viewer,
  type VisibleTask,
} from '../lib/ports/notification-targets';

const newestFirst = (a: NotificationRecord, b: NotificationRecord) =>
  b.occurredAt.getTime() - a.occurredAt.getTime() || (a.id < b.id ? 1 : -1);
const before = (row: NotificationRecord, position: NotificationPosition) =>
  row.occurredAt < position.occurredAt ||
  (row.occurredAt.getTime() === position.occurredAt.getTime() && row.id < position.id);

export class InMemoryNotificationRepository implements NotificationRepository {
  rows: NotificationRecord[] = [];
  /** `org|user` dos membros atuais (a FK do banco recusa os demais). */
  readonly members = new Set<string>();
  /** Tarefas existentes (FK). */
  readonly tasks = new Set<string>();

  async insert(notification: NewNotification): Promise<InsertOutcome> {
    if (
      !this.members.has(`${notification.organizationId}|${notification.recipientUserId}`) ||
      !this.tasks.has(notification.taskId)
    ) {
      return 'ineligible';
    }
    const duplicate = this.rows.some(
      (row) =>
        row.organizationId === notification.organizationId &&
        row.recipientUserId === notification.recipientUserId &&
        row.dedupeKey === notification.dedupeKey,
    );
    if (duplicate) return 'duplicate';
    this.rows.push({ ...notification, readAt: null, emailedAt: null });
    return 'created';
  }
  async countMentionsSince(
    organizationId: string,
    actorUserId: string,
    recipientUserId: string,
    since: Date,
  ) {
    return this.rows.filter(
      (row) =>
        row.organizationId === organizationId &&
        row.actorUserId === actorUserId &&
        row.recipientUserId === recipientUserId &&
        row.kind === 'mention' &&
        row.occurredAt >= since,
    ).length;
  }
  private own(organizationId: string, recipientUserId: string) {
    return this.rows.filter(
      (row) => row.organizationId === organizationId && row.recipientUserId === recipientUserId,
    );
  }
  async page(
    organizationId: string,
    recipientUserId: string,
    limit: number,
    after: NotificationPosition | null,
  ) {
    return this.own(organizationId, recipientUserId)
      .filter((row) => !after || before(row, after))
      .sort(newestFirst)
      .slice(0, limit);
  }
  async recentUnread(organizationId: string, recipientUserId: string, limit: number) {
    return this.own(organizationId, recipientUserId)
      .filter((row) => row.readAt === null)
      .sort(newestFirst)
      .slice(0, limit);
  }
  async findOwn(organizationId: string, recipientUserId: string, notificationId: string) {
    return (
      this.own(organizationId, recipientUserId).find((row) => row.id === notificationId) ?? null
    );
  }
  async markRead(
    organizationId: string,
    recipientUserId: string,
    notificationId: string,
    now: Date,
  ) {
    this.rows = this.rows.map((row) =>
      row.organizationId === organizationId &&
      row.recipientUserId === recipientUserId &&
      row.id === notificationId &&
      row.readAt === null
        ? { ...row, readAt: now }
        : row,
    );
  }
  async markAllRead(
    organizationId: string,
    recipientUserId: string,
    upTo: NotificationPosition | null,
    now: Date,
  ) {
    let count = 0;
    this.rows = this.rows.map((row) => {
      const inScope =
        row.organizationId === organizationId &&
        row.recipientUserId === recipientUserId &&
        row.readAt === null &&
        (!upTo || before(row, upTo) || row.id === upTo.id);
      if (!inScope) return row;
      count += 1;
      return { ...row, readAt: now };
    });
    return count;
  }
  /** Preferências para o fan-out (no banco, um `LEFT JOIN` na tabela do próprio contexto). */
  preferences: InMemoryNotificationPreferences | null = null;
  async digestRecipients(since: Date) {
    const ids = new Set(
      this.rows
        .filter((row) => row.readAt === null && row.emailedAt === null && row.occurredAt >= since)
        .map((row) => row.recipientUserId),
    );
    const enabled = await Promise.all(
      [...ids].map(async (id) => [id, (await this.preferences?.emailDigest(id)) ?? true] as const),
    );
    return enabled
      .filter(([, on]) => on)
      .map(([id]) => id)
      .sort();
  }
  async digestCandidates(recipientUserId: string, since: Date, limit: number) {
    return this.rows
      .filter(
        (row) =>
          row.recipientUserId === recipientUserId &&
          row.readAt === null &&
          row.emailedAt === null &&
          row.occurredAt >= since,
      )
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : 1))
      .slice(0, limit);
  }
  async markEmailed(recipientUserId: string, notificationIds: ReadonlyArray<string>, now: Date) {
    this.rows = this.rows.map((row) =>
      row.recipientUserId === recipientUserId &&
      notificationIds.includes(row.id) &&
      row.emailedAt === null
        ? { ...row, emailedAt: now }
        : row,
    );
  }
  async purgeBefore(cutoff: Date, batchSize: number) {
    const doomed = this.rows
      .filter((row) => row.occurredAt < cutoff)
      .slice(0, batchSize)
      .map((row) => row.id);
    this.rows = this.rows.filter((row) => !doomed.includes(row.id));
    return doomed.length;
  }
}

export class InMemoryNotificationPreferences implements NotificationPreferenceRepository {
  readonly values = new Map<string, boolean>();
  async emailDigest(userId: string) {
    return this.values.get(userId) ?? true;
  }
  async setEmailDigest(userId: string, emailDigest: boolean) {
    this.values.set(userId, emailDigest);
  }
}

/** Tarefas com chave, título e leitores por organização; menções ativas por chave. */
export class FakeNotificationTargets implements NotificationTargets {
  readonly tasks = new Map<
    string,
    { organizationId: string; key: string; title: string; readers: Set<string> }
  >();
  readonly mentions = new Set<string>();
  readonly calls: string[] = [];
  failWith: Error | null = null;

  async visibleTasks(organizationId: string, viewer: Viewer, taskIds: ReadonlyArray<string>) {
    this.calls.push('visibleTasks');
    if (this.failWith) throw this.failWith;
    const visible = new Map<string, VisibleTask>();
    for (const taskId of taskIds) {
      const task = this.tasks.get(taskId);
      const reads =
        task?.readers.has(viewer.userId) ||
        viewer.organizationRole === 'owner' ||
        viewer.organizationRole === 'admin';
      if (task && task.organizationId === organizationId && reads) {
        visible.set(taskId, { key: task.key, title: task.title });
      }
    }
    return visible;
  }
  async activeMentions(organizationId: string, mentions: ReadonlyArray<MentionReference>) {
    this.calls.push('activeMentions');
    if (this.failWith) throw this.failWith;
    return new Set(
      mentions
        .map(({ commentId, userId }) => activeMentionKey(commentId, userId))
        .filter((key) => this.mentions.has(`${organizationId}|${key}`)),
    );
  }
}

export class FakeNotificationPeople implements NotificationPeople {
  readonly names = new Map<string, string>();
  /** `org|user` → vínculo atual. */
  readonly memberOf = new Map<string, OrganizationMembership>();
  readonly addresses = new Map<string, DigestAddress>();

  async displayNames(organizationId: string, userIds: ReadonlyArray<string>) {
    return new Map(
      userIds.flatMap((userId) => {
        const name = this.names.get(userId);
        return name && this.memberOf.has(`${organizationId}|${userId}`)
          ? [[userId, name] as const]
          : [];
      }),
    );
  }
  async memberships(userId: string, organizationIds: ReadonlyArray<string>) {
    return new Map(
      organizationIds.flatMap((organizationId) => {
        const membership = this.memberOf.get(`${organizationId}|${userId}`);
        return membership ? [[organizationId, membership] as const] : [];
      }),
    );
  }
  async digestAddress(userId: string) {
    return this.addresses.get(userId) ?? null;
  }
  join(organizationId: string, userId: string, slug: string, role: OrganizationRole) {
    this.memberOf.set(`${organizationId}|${userId}`, { slug, role });
  }
}

export class RecordingDigestMailer implements DigestMailer {
  readonly sent: Array<{ to: { email: string; name: string }; digest: DigestEmail }> = [];
  failNext = false;
  async send(to: { email: string; name: string }, digest: DigestEmail) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('SMTP down');
    }
    this.sent.push({ to, digest });
  }
}

export function createNotificationsTestbed() {
  const notifications = new InMemoryNotificationRepository();
  const preferences = new InMemoryNotificationPreferences();
  notifications.preferences = preferences;
  return {
    notifications,
    preferences,
    targets: new FakeNotificationTargets(),
    people: new FakeNotificationPeople(),
    mailer: new RecordingDigestMailer(),
    appUrl: 'https://app.taskflow.test',
    rateLimiter: new InMemoryRateLimiter(),
    clock: new FixedClock(new Date('2026-10-15T12:00:00.000Z')),
    idGenerator: new SequentialIds(),
  };
}

export type NotificationsTestbed = ReturnType<typeof createNotificationsTestbed>;
