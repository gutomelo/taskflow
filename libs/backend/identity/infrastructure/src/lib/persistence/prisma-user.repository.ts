import { VersionConflictError, type EmailAddress } from '@taskflow/backend/shared/kernel';
import {
  EmailAlreadyRegisteredError,
  type User,
  type UserRepository,
  type UserSearchPosition,
} from '@taskflow/backend/identity/domain';
import {
  isUniqueConstraintViolation,
  type PrismaTransactionRunner,
} from '@taskflow/backend/shared/infrastructure';
import { toUser } from './identity-mappers';

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.transactions.client().user.findUnique({ where: { id } });
    return row ? toUser(row) : null;
  }

  async findByEmail(email: EmailAddress): Promise<User | null> {
    const row = await this.transactions.client().user.findUnique({ where: { email: email.value } });
    return row ? toUser(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<User[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.transactions
      .client()
      .user.findMany({ where: { id: { in: [...ids] } } });
    return rows.map(toUser);
  }

  async searchAmong(
    ids: readonly string[],
    query: string,
    limit: number,
    after: UserSearchPosition | null,
  ): Promise<User[]> {
    if (ids.length === 0) return [];
    // `contains` do Prisma não escapa `%`/`_` do LIKE: escapados aqui para serem literais.
    const literal = query.replace(/[\\%_]/g, (character) => `\\${character}`);
    const rows = await this.transactions.client().user.findMany({
      where: {
        id: { in: [...ids] },
        OR: [
          { name: { contains: literal, mode: 'insensitive' } },
          { email: { contains: literal, mode: 'insensitive' } },
        ],
        ...(after
          ? {
              AND: [
                { OR: [{ name: { gt: after.name } }, { name: after.name, id: { gt: after.id } }] },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toUser);
  }

  async add(user: User): Promise<void> {
    const snapshot = user.toSnapshot();
    try {
      await this.transactions.client().user.create({
        data: {
          id: snapshot.id,
          email: snapshot.email.value,
          name: snapshot.name.value,
          passwordHash: snapshot.passwordHash,
          emailVerifiedAt: snapshot.emailVerifiedAt,
          passwordChangedAt: snapshot.passwordChangedAt,
          createdAt: snapshot.createdAt,
          version: snapshot.version,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
  }

  async save(user: User): Promise<void> {
    const snapshot = user.toSnapshot();
    const { count } = await this.transactions.client().user.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: {
        name: snapshot.name.value,
        passwordHash: snapshot.passwordHash,
        emailVerifiedAt: snapshot.emailVerifiedAt,
        passwordChangedAt: snapshot.passwordChangedAt,
        version: { increment: 1 },
      },
    });
    if (count === 0) {
      throw new VersionConflictError('User');
    }
  }
}
