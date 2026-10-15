import type { NotificationRecord } from '@taskflow/backend/notifications/domain';
import { activeMentionKey, type Viewer, type VisibleTask } from '../ports/notification-targets';
import type { NotificationsDependencies } from './notifications-dependencies';

export type VisibleNotification = Readonly<{ notification: NotificationRecord; task: VisibleTask }>;

/**
 * D3: só as notificações cujo alvo o leitor vê agora — tarefa visível e, nas menções, menção ainda
 * existente em comentário não removido daquela tarefa. Em lote (no máximo duas consultas por
 * porta); erro da porta propaga (falha fechado).
 */
export async function visibleOnly(
  deps: Pick<NotificationsDependencies, 'targets'>,
  organizationId: string,
  viewer: Viewer,
  rows: ReadonlyArray<NotificationRecord>,
): Promise<VisibleNotification[]> {
  if (rows.length === 0) return [];
  const tasks = await deps.targets.visibleTasks(organizationId, viewer, [
    ...new Set(rows.map((row) => row.taskId)),
  ]);
  const mentions = rows.flatMap((row) =>
    row.kind === 'mention' && row.commentId !== null && tasks.has(row.taskId)
      ? [{ taskId: row.taskId, commentId: row.commentId, userId: row.recipientUserId }]
      : [],
  );
  const active =
    mentions.length === 0
      ? new Set<string>()
      : await deps.targets.activeMentions(organizationId, mentions);
  return rows.flatMap((notification) => {
    const task = tasks.get(notification.taskId);
    if (!task) return [];
    if (notification.kind === 'mention') {
      if (
        notification.commentId === null ||
        !active.has(activeMentionKey(notification.commentId, notification.recipientUserId))
      ) {
        return [];
      }
    }
    return [{ notification, task }];
  });
}
