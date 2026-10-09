/** Cursor opaco da paginação por chave (createdAt, id): estável sob inserções concorrentes. */
export type KeysetPosition = Readonly<{ createdAt: Date; id: string }>;

export function encodeCursor(position: KeysetPosition): string {
  return Buffer.from(
    JSON.stringify({ c: position.createdAt.toISOString(), i: position.id }),
    'utf8',
  ).toString('base64url');
}

/** Cursor inválido ou adulterado ⇒ `null` (o chamador recomeça do início). */
export function decodeCursor(cursor: string | null): KeysetPosition | null {
  if (!cursor) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null) return null;
    const { c, i } = value as Record<string, unknown>; // verificados campo a campo abaixo
    const createdAt = typeof c === 'string' ? new Date(c) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime()) || typeof i !== 'string') return null;
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
