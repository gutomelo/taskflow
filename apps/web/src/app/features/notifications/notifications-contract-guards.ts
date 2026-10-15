import type {
  NotificationDto,
  NotificationPage,
  NotificationPreference,
  UnreadCount,
} from '@taskflow/contracts';

// Verificações de forma das respostas de notificações (spec 008). Como em `core/http`, os
// contratos entram no frontend só como tipos: Zod no bundle inicial custaria caro.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isDateTime = (value: unknown) => typeof value === 'string' && ISO_DATE_TIME.test(value);

export function isNotification(value: unknown): value is NotificationDto {
  if (!isRecord(value)) return false;
  const { actor, task } = value;
  return (
    isUuid(value['id']) &&
    (value['kind'] === 'mention' || value['kind'] === 'assignment') &&
    isRecord(actor) &&
    isUuid(actor['userId']) &&
    (actor['name'] === null || typeof actor['name'] === 'string') &&
    isRecord(task) &&
    isUuid(task['id']) &&
    typeof task['key'] === 'string' &&
    typeof task['title'] === 'string' &&
    (value['commentId'] === null || isUuid(value['commentId'])) &&
    isDateTime(value['occurredAt']) &&
    (value['readAt'] === null || isDateTime(value['readAt']))
  );
}

export function isNotificationPage(value: unknown): value is NotificationPage {
  if (!isRecord(value)) return false;
  const { items, nextCursor } = value;
  return (
    Array.isArray(items) &&
    items.every(isNotification) &&
    (nextCursor === null || typeof nextCursor === 'string')
  );
}

export function isUnreadCount(value: unknown): value is UnreadCount {
  if (!isRecord(value)) return false;
  const { count } = value;
  return (
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= 0 &&
    count <= 99 &&
    typeof value['capped'] === 'boolean'
  );
}

export function isNotificationPreference(value: unknown): value is NotificationPreference {
  return isRecord(value) && typeof value['emailDigest'] === 'boolean';
}
