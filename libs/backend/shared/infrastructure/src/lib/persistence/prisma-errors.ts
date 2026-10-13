import { Prisma } from '../../generated/prisma/client';

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
