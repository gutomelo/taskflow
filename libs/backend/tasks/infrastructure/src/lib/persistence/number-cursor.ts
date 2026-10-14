/** Cursor opaco da lista de tarefas: só o número (ordem decrescente), nunca o projeto. */
export function encodeCursor(number: number): string {
  return Buffer.from(JSON.stringify({ n: number }), 'utf8').toString('base64url');
}

/** Inválido ou adulterado ⇒ `null` (recomeça do início). */
export function decodeCursor(cursor: string | null): number | null {
  if (!cursor) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null || !('n' in value)) return null;
    const { n } = value;
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 1_000_000_000 ? n : null;
  } catch {
    return null;
  }
}
