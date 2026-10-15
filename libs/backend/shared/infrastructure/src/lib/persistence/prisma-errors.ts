import { Prisma } from '../../generated/prisma/client';

const CONFLICT_SQLSTATES: ReadonlySet<string> = new Set(['40P01', '40001']);

function sqlStateOf(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null || !('driverAdapterError' in meta)) return null;
  const adapterError: unknown = meta.driverAdapterError;
  if (typeof adapterError !== 'object' || adapterError === null || !('cause' in adapterError))
    return null;
  const cause: unknown = adapterError.cause;
  if (typeof cause !== 'object' || cause === null || !('originalCode' in cause)) return null;
  return typeof cause.originalCode === 'string' ? cause.originalCode : null;
}

/**
 * Deadlock ou conflito de escrita (`P2034`; ou SQLSTATE `40P01`/`40001` vindo de SQL raw): a
 * transação inteira pode ser repetida (efeitos externos nunca rodam dentro dela).
 */
export function isTransactionConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  const sqlState = sqlStateOf(error.meta);
  return sqlState !== null && CONFLICT_SQLSTATES.has(sqlState);
}

/**
 * Espera por lock excedida (`lock_timeout`, SQLSTATE `55P03`): não é repetida — repetir esperaria
 * de novo pela mesma contenção.
 */
export function isLockTimeout(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && sqlStateOf(error.meta) === '55P03'
  );
}

/**
 * Violação de UNIQUE (código P2002). Repositórios traduzem para erros de domínio — por
 * exemplo, cadastro concorrente com o mesmo e-mail.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Violação de FOREIGN KEY (código P2003). Ex.: participação de projeto para quem deixou de ser
 * membro da organização (FK do ADR 0015) — o repositório traduz para o erro de domínio.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}
