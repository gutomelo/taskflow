import type { CommentPosition } from '@taskflow/backend/collaboration/domain';
import { InvalidCursorError } from './collaboration-errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encode(value: Readonly<Record<string, string>>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decode(cursor: string): Readonly<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value));
    }
  } catch {
    // Cai no erro abaixo: malformado é o mesmo 400 que adulterado.
  }
  throw new InvalidCursorError();
}

/** Cursor opaco da conversa: `(taskId, created_at, id)` do último comentário da página. */
export function encodeCommentCursor(taskId: string, position: CommentPosition): string {
  return encode({ t: taskId, c: position.createdAt.toISOString(), i: position.id });
}

/** Malformado, adulterado ou de outra tarefa ⇒ `INVALID_CURSOR` (400), sem chegar ao banco. */
export function decodeCommentCursor(cursor: string | null, taskId: string): CommentPosition | null {
  if (cursor === null || cursor === '') return null;
  const { t, c, i } = decode(cursor);
  const createdAt = typeof c === 'string' ? new Date(c) : null;
  if (
    t !== taskId ||
    !createdAt ||
    Number.isNaN(createdAt.getTime()) ||
    typeof i !== 'string' ||
    !UUID.test(i)
  ) {
    throw new InvalidCursorError();
  }
  return { createdAt, id: i };
}

/** Cursor dos candidatos: o de `identity` (opaco) amarrado à tarefa e ao texto buscado. */
export function encodeCandidateCursor(taskId: string, query: string, inner: string): string {
  return encode({ t: taskId, q: query, c: inner });
}

export function decodeCandidateCursor(
  cursor: string | null,
  taskId: string,
  query: string,
): string | null {
  if (cursor === null || cursor === '') return null;
  const { t, q, c } = decode(cursor);
  if (t !== taskId || q !== query || typeof c !== 'string' || c.length > 512) {
    throw new InvalidCursorError();
  }
  return c;
}
