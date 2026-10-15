import type {
  InsertOutcome,
  NewNotification,
  NotificationPosition,
  NotificationPreferenceRepository,
  NotificationRecord,
  NotificationRepository,
} from '@taskflow/backend/notifications/domain';
import {
  isForeignKeyViolation,
  type PrismaTransactionRunner,
} from '@taskflow/backend/shared/infrastructure';

const newestFirst = [{ occurredAt: 'desc' }, { id: 'desc' }] as const;

/** Depois de `position` na ordem `(occurred_at DESC, id DESC)`. */
const after = (position: NotificationPosition) => ({
  OR: [
    { occurredAt: { lt: position.occurredAt } },
    { occurredAt: position.occurredAt, id: { lt: position.id } },
  ],
});

/** Até `position`, inclusive, na mesma ordem. */
const upTo = (position: NotificationPosition) => ({
  OR: [
    { occurredAt: { lt: position.occurredAt } },
    { occurredAt: position.occurredAt, id: { lte: position.id } },
  ],
});

/**
 * Notificações são pessoais: toda operação do usuário filtra `organizationId` **e**
 * `recipientUserId`. As do worker (resumo, retenção) filtram o destinatário ou só apagam vencidas.
 */
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async insert(notification: NewNotification): Promise<InsertOutcome> {
    try {
      const { count } = await this.transactions.client().notification.createMany({
        data: [notification],
        skipDuplicates: true,
      });
      return count === 1 ? 'created' : 'duplicate';
    } catch (error) {
      // Destinatário que saiu da organização ou tarefa excluída antes do processamento (ADR 0015).
      if (isForeignKeyViolation(error)) return 'ineligible';
      throw error;
    }
  }

  countMentionsSince(
    organizationId: string,
    actorUserId: string,
    recipientUserId: string,
    since: Date,
  ): Promise<number> {
    return this.transactions.client().notification.count({
      where: {
        organizationId,
        recipientUserId,
        actorUserId,
        kind: 'mention',
        occurredAt: { gte: since },
      },
    });
  }

  page(
    organizationId: string,
    recipientUserId: string,
    limit: number,
    position: NotificationPosition | null,
  ): Promise<ReadonlyArray<NotificationRecord>> {
    return this.transactions.client().notification.findMany({
      where: { organizationId, recipientUserId, ...(position ? after(position) : {}) },
      orderBy: [...newestFirst],
      take: limit,
    });
  }

  recentUnread(
    organizationId: string,
    recipientUserId: string,
    limit: number,
  ): Promise<ReadonlyArray<NotificationRecord>> {
    return this.transactions.client().notification.findMany({
      where: { organizationId, recipientUserId, readAt: null },
      orderBy: [...newestFirst],
      take: limit,
    });
  }

  findOwn(
    organizationId: string,
    recipientUserId: string,
    notificationId: string,
  ): Promise<NotificationRecord | null> {
    return this.transactions.client().notification.findFirst({
      where: { id: notificationId, organizationId, recipientUserId },
    });
  }

  async markRead(
    organizationId: string,
    recipientUserId: string,
    notificationId: string,
    now: Date,
  ): Promise<void> {
    await this.transactions.client().notification.updateMany({
      where: { id: notificationId, organizationId, recipientUserId, readAt: null },
      data: { readAt: now },
    });
  }

  async markAllRead(
    organizationId: string,
    recipientUserId: string,
    position: NotificationPosition | null,
    now: Date,
  ): Promise<number> {
    const { count } = await this.transactions.client().notification.updateMany({
      where: {
        organizationId,
        recipientUserId,
        readAt: null,
        ...(position ? upTo(position) : {}),
      },
      data: { readAt: now },
    });
    return count;
  }

  async digestRecipients(since: Date): Promise<ReadonlyArray<string>> {
    // Tabelas do próprio contexto; sem linha de preferência = resumo ligado.
    const rows = await this.transactions.client().$queryRaw<Array<{ recipient_user_id: string }>>`
      SELECT DISTINCT n.recipient_user_id
      FROM notifications n
      LEFT JOIN notification_preferences p ON p.user_id = n.recipient_user_id
      WHERE n.read_at IS NULL AND n.emailed_at IS NULL AND n.occurred_at >= ${since}
        AND COALESCE(p.email_digest, true)
      ORDER BY n.recipient_user_id`;
    return rows.map((row) => row.recipient_user_id);
  }

  digestCandidates(
    recipientUserId: string,
    since: Date,
    limit: number,
  ): Promise<ReadonlyArray<NotificationRecord>> {
    return this.transactions.client().notification.findMany({
      where: { recipientUserId, readAt: null, emailedAt: null, occurredAt: { gte: since } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async markEmailed(
    recipientUserId: string,
    notificationIds: ReadonlyArray<string>,
    now: Date,
  ): Promise<void> {
    if (notificationIds.length === 0) return;
    await this.transactions.client().notification.updateMany({
      where: { recipientUserId, id: { in: [...notificationIds] }, emailedAt: null },
      data: { emailedAt: now },
    });
  }

  purgeBefore(cutoff: Date, batchSize: number): Promise<number> {
    // Em lotes curtos: não compete com a cascata da membership (I6 da segurança).
    return this.transactions.client().$executeRaw`
      DELETE FROM notifications
      WHERE id IN (
        SELECT id FROM notifications WHERE occurred_at < ${cutoff} ORDER BY occurred_at LIMIT ${batchSize}
      )`;
  }
}

export class PrismaNotificationPreferenceRepository implements NotificationPreferenceRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async emailDigest(userId: string): Promise<boolean> {
    const row = await this.transactions.client().notificationPreference.findUnique({
      where: { userId },
      select: { emailDigest: true },
    });
    return row?.emailDigest ?? true;
  }

  async setEmailDigest(userId: string, emailDigest: boolean, now: Date): Promise<void> {
    await this.transactions.client().notificationPreference.upsert({
      where: { userId },
      create: { userId, emailDigest, updatedAt: now },
      update: { emailDigest, updatedAt: now },
    });
  }
}
