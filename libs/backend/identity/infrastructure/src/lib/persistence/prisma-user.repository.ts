import { VersionConflictError, type EmailAddress } from '@taskflow/backend/shared/kernel';
import {
  EmailAlreadyRegisteredError,
  type User,
  type UserRepository,
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
