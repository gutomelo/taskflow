/**
 * Cursor opaco da paginação por chave `(valor de ordenação, id)`: estável sob inserções
 * concorrentes. Projetos ordenam por `(name, id)`; participantes por `(createdAt, userId)`.
 */
export type KeysetPosition = Readonly<{ value: string; id: string }>;

export function encodeCursor(position: KeysetPosition): string {
  return Buffer.from(JSON.stringify({ v: position.value, i: position.id }), 'utf8').toString(
    'base64url',
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cursor inválido ou adulterado ⇒ `null` (o chamador recomeça do início). O id precisa ser UUID:
 * um valor qualquer chegaria à comparação com a coluna `uuid` e viraria erro 500.
 */
export function decodeCursor(cursor: string | null): KeysetPosition | null {
  if (!cursor) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null || !('v' in value) || !('i' in value)) {
      return null;
    }
    const { v, i } = value;
    if (typeof v !== 'string' || v.length > 200) return null;
    if (typeof i !== 'string' || !UUID.test(i)) return null;
    return { value: v, id: i };
  } catch {
    return null;
  }
}

/** Data do cursor de participantes; inválida ⇒ `null`. */
export function dateFrom(position: KeysetPosition | null): Date | null {
  if (!position) return null;
  const date = new Date(position.value);
  return Number.isNaN(date.getTime()) ? null : date;
}
