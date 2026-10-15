import {
  RateLimitedError,
  type RateLimitPolicy,
  type TenantRequestContext,
} from '@taskflow/backend/shared/application';
import {
  NOTIFICATION_LIMITS,
  NotificationNotFoundError,
  requireOwn,
  type NotificationKind,
} from '@taskflow/backend/notifications/domain';
import type { Viewer } from '../ports/notification-targets';
import { decodeNotificationCursor, encodeNotificationCursor } from '../shared/notification-cursor';
import type { NotificationsDependencies } from '../shared/notifications-dependencies';
import {
  NOTIFICATIONS_COUNT_POLICY,
  NOTIFICATIONS_DEFAULT_PAGE,
  NOTIFICATIONS_LIST_POLICY,
  NOTIFICATIONS_MAX_PAGE,
  NOTIFICATIONS_PREFERENCE_POLICY,
  NOTIFICATIONS_WRITE_POLICY,
} from '../shared/notifications-limits';
import { visibleOnly } from '../shared/visibility';

/** `name: null` = "Ex-membro". */
export type NotificationView = Readonly<{
  id: string;
  kind: NotificationKind;
  actor: Readonly<{ userId: string; name: string | null }>;
  task: Readonly<{ id: string; key: string; title: string }>;
  commentId: string | null;
  occurredAt: Date;
  readAt: Date | null;
}>;

const viewerOf = (context: TenantRequestContext): Viewer => ({
  userId: context.actor.userId,
  organizationRole: context.tenant.organizationRole,
});

async function consume(
  deps: Pick<NotificationsDependencies, 'rateLimiter'>,
  policy: RateLimitPolicy,
  context: TenantRequestContext | string,
): Promise<void> {
  const userId = typeof context === 'string' ? context : context.actor.userId;
  const decision = await deps.rateLimiter.consume(policy, userId);
  if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
}

/**
 * RF-04/RF-07: as notificações do próprio usuário na organização ativa, mais recentes primeiro.
 * Busca `limit` linhas e filtra a validade: **páginas curtas ou vazias são válidas** (I4).
 */
export class ListNotificationsUseCase {
  constructor(private readonly deps: NotificationsDependencies) {}

  async execute(
    context: TenantRequestContext,
    query: Readonly<{ cursor?: string | null; limit?: number }>,
  ): Promise<Readonly<{ items: ReadonlyArray<NotificationView>; nextCursor: string | null }>> {
    await consume(this.deps, NOTIFICATIONS_LIST_POLICY, context);
    const { organizationId } = context.tenant;
    const after = decodeNotificationCursor(query.cursor ?? null);
    const limit = Math.min(
      Math.max(Math.trunc(query.limit ?? NOTIFICATIONS_DEFAULT_PAGE), 1),
      NOTIFICATIONS_MAX_PAGE,
    );
    const rows = await this.deps.notifications.page(
      organizationId,
      context.actor.userId,
      limit,
      after,
    );
    const visible = await visibleOnly(this.deps, organizationId, viewerOf(context), rows);
    const names = await this.deps.people.displayNames(organizationId, [
      ...new Set(visible.map(({ notification }) => notification.actorUserId)),
    ]);
    const last = rows.at(-1);
    return {
      items: visible.map(({ notification, task }) => ({
        id: notification.id,
        kind: notification.kind,
        actor: {
          userId: notification.actorUserId,
          name: names.get(notification.actorUserId) ?? null,
        },
        task: { id: notification.taskId, key: task.key, title: task.title },
        commentId: notification.commentId,
        occurredAt: notification.occurredAt,
        readAt: notification.readAt,
      })),
      nextCursor:
        rows.length === limit && last
          ? encodeNotificationCursor({ occurredAt: last.occurredAt, id: last.id })
          : null,
    };
  }
}

/**
 * RF-05: não lidas **visíveis** da organização ativa. Sem não lidas, nenhuma porta é chamada (o
 * caso comum do polling — `visibleOnly` retorna antes); senão analisa as 200 mais recentes e
 * satura em 99.
 */
export class CountUnreadUseCase {
  constructor(private readonly deps: NotificationsDependencies) {}

  async execute(
    context: TenantRequestContext,
  ): Promise<Readonly<{ count: number; capped: boolean }>> {
    await consume(this.deps, NOTIFICATIONS_COUNT_POLICY, context);
    const { organizationId } = context.tenant;
    const rows = await this.deps.notifications.recentUnread(
      organizationId,
      context.actor.userId,
      NOTIFICATION_LIMITS.unreadScan,
    );
    const visible = await visibleOnly(this.deps, organizationId, viewerOf(context), rows);
    const cap = NOTIFICATION_LIMITS.unreadCap;
    // `capped` = há mais que o teto (a interface mostra "99+").
    return { count: Math.min(visible.length, cap), capped: visible.length > cap };
  }
}

/** RF-06: marca uma como lida. Alheia, inexistente ou invisível ⇒ o mesmo 404. */
export class MarkReadUseCase {
  constructor(private readonly deps: NotificationsDependencies) {}

  async execute(context: TenantRequestContext, notificationId: string): Promise<void> {
    await consume(this.deps, NOTIFICATIONS_WRITE_POLICY, context);
    const { organizationId } = context.tenant;
    const own = requireOwn(
      await this.deps.notifications.findOwn(organizationId, context.actor.userId, notificationId),
    );
    const [visible] = await visibleOnly(this.deps, organizationId, viewerOf(context), [own]);
    if (!visible) throw new NotificationNotFoundError();
    await this.deps.notifications.markRead(
      organizationId,
      context.actor.userId,
      notificationId,
      this.deps.clock.now(),
    );
  }
}

/**
 * RF-06: marca todas as não lidas do próprio usuário na organização até `upToId` (inclusive;
 * ausente = todas) — inclusive as invisíveis agora (I5 da segurança, S6 da arquitetura).
 */
export class MarkAllReadUseCase {
  constructor(private readonly deps: NotificationsDependencies) {}

  async execute(
    context: TenantRequestContext,
    command: Readonly<{ upToId?: string }>,
  ): Promise<void> {
    await consume(this.deps, NOTIFICATIONS_WRITE_POLICY, context);
    const { organizationId } = context.tenant;
    const recipientUserId = context.actor.userId;
    const limit =
      command.upToId === undefined
        ? null
        : requireOwn(
            await this.deps.notifications.findOwn(organizationId, recipientUserId, command.upToId),
          );
    await this.deps.notifications.markAllRead(
      organizationId,
      recipientUserId,
      limit ? { occurredAt: limit.occurredAt, id: limit.id } : null,
      this.deps.clock.now(),
    );
  }
}

/** RF-09: preferência global da própria conta (rotas `/me`). */
export class GetNotificationPreferenceUseCase {
  constructor(
    private readonly deps: Pick<NotificationsDependencies, 'preferences' | 'rateLimiter'>,
  ) {}

  async execute(userId: string): Promise<Readonly<{ emailDigest: boolean }>> {
    await consume(this.deps, NOTIFICATIONS_PREFERENCE_POLICY, userId);
    return { emailDigest: await this.deps.preferences.emailDigest(userId) };
  }
}

/** RF-09: última escrita vence (um booleano, sem conflito a resolver — S4 da arquitetura). */
export class UpdateNotificationPreferenceUseCase {
  constructor(
    private readonly deps: Pick<NotificationsDependencies, 'preferences' | 'clock' | 'rateLimiter'>,
  ) {}

  async execute(
    userId: string,
    command: Readonly<{ emailDigest: boolean }>,
  ): Promise<Readonly<{ emailDigest: boolean }>> {
    // Auditoria da 008 (B1): sem limite, um laço de PUT amplificaria escritas no banco.
    await consume(this.deps, NOTIFICATIONS_PREFERENCE_POLICY, userId);
    await this.deps.preferences.setEmailDigest(userId, command.emailDigest, this.deps.clock.now());
    return { emailDigest: command.emailDigest };
  }
}
