import type { NotificationPosition } from '@taskflow/backend/notifications/domain';
import { InvalidCursorError } from './notifications-errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeNotificationCursor(position: NotificationPosition): string {
  return Buffer.from(
    JSON.stringify({ o: position.occurredAt.toISOString(), i: position.id }),
    'utf8',
  ).toString('base64url');
}

/**
 * Malformado ⇒ `INVALID_CURSOR` (400). Válido, só desloca o keyset dentro das notificações do
 * próprio destinatário (no harness: `noLeak`, B1 da revisão de segurança).
 */
export function decodeNotificationCursor(cursor: string | null): NotificationPosition | null {
  if (cursor === null || cursor === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  if (typeof value !== 'object' || value === null) throw new InvalidCursorError();
  const o = 'o' in value ? value.o : undefined;
  const i = 'i' in value ? value.i : undefined;
  const occurredAt = typeof o === 'string' ? new Date(o) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime()) || typeof i !== 'string' || !UUID.test(i)) {
    throw new InvalidCursorError();
  }
  return { occurredAt, id: i };
}
