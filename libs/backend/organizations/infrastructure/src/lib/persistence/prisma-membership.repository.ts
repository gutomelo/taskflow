import { VersionConflictError, type OrganizationRole } from '@taskflow/backend/shared/kernel';
import {
  AlreadyAMemberError,
  type Membership,
  type MembershipRepository,
  type Page,
  type PageRequest,
} from '@taskflow/backend/organizations/domain';
import {
  isUniqueConstraintViolation,
  type PrismaTransactionRunner,
} from '@taskflow/backend/shared/infrastructure';
import { afterPosition, decodeCursor, encodeCursor } from './keyset-cursor';
import { roleFrom, toMembership } from './organizations-mappers';

/** Toda operação aplica `organizationId` em leitura **e** escrita (isolamento entre tenants). */
export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async add(membership: Membership): Promise<void> {
    try {
      await this.transactions.client().membership.create({ data: membership.toSnapshot() });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw new AlreadyAMemberError();
      throw error;
    }
  }

  async find(organizationId: string, userId: string): Promise<Membership | null> {
    const row = await this.transactions.client().membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    return row ? toMembership(row) : null;
  }

  async listPage(
    organizationId: string,
    { limit, cursor }: PageRequest,
  ): Promise<Page<Membership>> {
    const rows = await this.transactions.client().membership.findMany({
      where: { organizationId, ...afterPosition(decodeCursor(cursor)) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(toMembership),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  async listPageExcluding(
    organizationId: string,
    {
      excludeUserIds,
      roles,
    }: Readonly<{ excludeUserIds: ReadonlyArray<string>; roles: ReadonlyArray<OrganizationRole> }>,
    { limit, cursor }: PageRequest,
  ): Promise<Page<Membership>> {
    const rows = await this.transactions.client().membership.findMany({
      where: {
        organizationId,
        userId: { notIn: [...excludeUserIds] },
        role: { in: [...roles] },
        ...afterPosition(decodeCursor(cursor)),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(toMembership),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  async rolesOf(
    organizationId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, OrganizationRole>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.transactions.client().membership.findMany({
      where: { organizationId, userId: { in: [...userIds] } },
      select: { userId: true, role: true },
    });
    return new Map(rows.map((row) => [row.userId, roleFrom(row.role)]));
  }

  async listForUser(userId: string): Promise<ReadonlyArray<Membership>> {
    const rows = await this.transactions.client().membership.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toMembership);
  }

  countForUser(userId: string): Promise<number> {
    return this.transactions.client().membership.count({ where: { userId } });
  }

  countOwnedBy(userId: string): Promise<number> {
    return this.transactions.client().membership.count({ where: { userId, role: 'owner' } });
  }

  countOwners(organizationId: string): Promise<number> {
    return this.transactions
      .client()
      .membership.count({ where: { organizationId, role: 'owner' } });
  }

  async save(membership: Membership): Promise<void> {
    const { organizationId, userId, role, version, updatedAt } = membership.toSnapshot();
    const { count } = await this.transactions.client().membership.updateMany({
      where: { organizationId, userId, version },
      data: { role, updatedAt, version: { increment: 1 } },
    });
    if (count === 0) throw new VersionConflictError('Membership');
  }

  async remove(organizationId: string, userId: string, version: number): Promise<void> {
    const { count } = await this.transactions.client().membership.deleteMany({
      where: { organizationId, userId, version },
    });
    if (count === 0) throw new VersionConflictError('Membership');
  }
}
