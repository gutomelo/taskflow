import { Prisma } from '../../generated/prisma/client';

/**
 * Violação de UNIQUE (código P2002). Repositórios traduzem para erros de domínio — por
 * exemplo, cadastro concorrente com o mesmo e-mail.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
