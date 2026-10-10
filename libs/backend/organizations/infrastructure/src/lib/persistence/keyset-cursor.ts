/** Cursor opaco da paginação por chave (createdAt, id): estável sob inserções concorrentes. */
export type KeysetPosition = Readonly<{ createdAt: Date; id: string }>;

export function encodeCursor(position: KeysetPosition): string {
  return Buffer.from(
    JSON.stringify({ c: position.createdAt.toISOString(), i: position.id }),
    'utf8',
  ).toString('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cursor inválido ou adulterado ⇒ `null` (o chamador recomeça do início). O id precisa ser UUID:
 * um valor qualquer chegaria à comparação com a coluna `uuid` e viraria erro 500 (auditoria T23).
 */
export function decodeCursor(cursor: string | null): KeysetPosition | null {
  if (!cursor) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null || !('c' in value) || !('i' in value)) {
      return null;
    }
    const { c, i } = value;
    const createdAt = typeof c === 'string' ? new Date(c) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) return null;
    if (typeof i !== 'string' || !UUID.test(i)) return null;
    return { createdAt, id: i };
  } catch {
    return null;
  }
}

/** Condição "depois da posição" na ordem (createdAt, id). */
export function afterPosition(position: KeysetPosition | null) {
  return position
    ? {
        OR: [
          { createdAt: { gt: position.createdAt } },
          { createdAt: position.createdAt, id: { gt: position.id } },
        ],
      }
    : {};
}
