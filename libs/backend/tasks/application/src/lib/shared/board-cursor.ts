import { isValidRank, type RankedCard } from '@taskflow/backend/tasks/domain';
import { InvalidCursorError } from './tasks-errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cursor opaco da coluna: `(statusId, rank, id)` do último card da página. */
export function encodeColumnCursor(statusId: string, card: RankedCard): string {
  return Buffer.from(JSON.stringify({ s: statusId, r: card.rank, i: card.id }), 'utf8').toString(
    'base64url',
  );
}

/**
 * B3 da segurança: malformado, com chave inválida ou de outra coluna ⇒ `INVALID_CURSOR` (400),
 * sem chegar ao banco. Mesmo válido, só desloca o keyset dentro do filtro da coluna.
 */
export function decodeColumnCursor(cursor: string | null, statusId: string): RankedCard | null {
  if (cursor === null || cursor === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  if (typeof value !== 'object' || value === null) throw new InvalidCursorError();
  const s = 's' in value ? value.s : undefined;
  const r = 'r' in value ? value.r : undefined;
  const i = 'i' in value ? value.i : undefined;
  if (
    s !== statusId ||
    typeof r !== 'string' ||
    !isValidRank(r) ||
    typeof i !== 'string' ||
    !UUID.test(i)
  ) {
    throw new InvalidCursorError();
  }
  return { rank: r, id: i };
}
