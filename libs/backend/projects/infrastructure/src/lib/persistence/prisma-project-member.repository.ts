import { VersionConflictError } from '@taskflow/backend/shared/kernel';
import {
  AlreadyAProjectMemberError,
  NotAnOrganizationMemberError,
  type Page,
  type PageRequest,
  type ProjectMember,
  type ProjectMemberRepository,
} from '@taskflow/backend/projects/domain';
import {
  isForeignKeyViolation,
  isUniqueConstraintViolation,
  type PrismaTransactionRunner,
} from '@taskflow/backend/shared/infrastructure';
import { dateFrom, decodeCursor, encodeCursor } from './keyset-cursor';
import { toProjectMember } from './projects-mappers';

/**
 * Participações sempre localizadas por `(organizationId, projectId, userId)`: nunca só pelo
 * usuário (um manager de um projeto não alcança participações de outro — IDOR).
 */
export class PrismaProjectMemberRepository implements ProjectMemberRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async add(member: ProjectMember): Promise<void> {
    try {
      await this.transactions.client().projectMember.create({ data: member.toSnapshot() });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw new AlreadyAProjectMemberError();
      // ADR 0015: a FK para `memberships` recusa quem não é (mais) membro da organização.
      if (isForeignKeyViolation(error)) throw new NotAnOrganizationMemberError();
      throw error;
    }
  }

  async find(
    organizationId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectMember | null> {
    const row = await this.transactions.client().projectMember.findUnique({
      where: { organizationId_projectId_userId: { organizationId, projectId, userId } },
    });
    return row ? toProjectMember(row) : null;
  }

  async listPage(
    organizationId: string,
    projectId: string,
    { limit, cursor }: PageRequest,
  ): Promise<Page<ProjectMember>> {
    const position = decodeCursor(cursor);
    const after = dateFrom(position);
    const rows = await this.transactions.client().projectMember.findMany({
      where: {
        organizationId,
        projectId,
        ...(position && after
          ? {
              OR: [{ createdAt: { gt: after } }, { createdAt: after, userId: { gt: position.id } }],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(toProjectMember),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: last.userId })
          : null,
    };
  }

  async listUserIds(organizationId: string, projectId: string): Promise<ReadonlyArray<string>> {
    const rows = await this.transactions.client().projectMember.findMany({
      where: { organizationId, projectId },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  count(organizationId: string, projectId: string): Promise<number> {
    return this.transactions.client().projectMember.count({ where: { organizationId, projectId } });
  }

  async save(member: ProjectMember): Promise<void> {
    const { organizationId, projectId, userId, role, version, updatedAt } = member.toSnapshot();
    const { count } = await this.transactions.client().projectMember.updateMany({
      where: { organizationId, projectId, userId, version },
      data: { role, updatedAt, version: { increment: 1 } },
    });
    if (count === 0) throw new VersionConflictError('ProjectMember');
  }

  async remove(
    organizationId: string,
    projectId: string,
    userId: string,
    version: number,
  ): Promise<void> {
    const { count } = await this.transactions.client().projectMember.deleteMany({
      where: { organizationId, projectId, userId, version },
    });
    if (count === 0) throw new VersionConflictError('ProjectMember');
  }

  async capToViewer(organizationId: string, userId: string, now: Date): Promise<number> {
    const transaction = this.transactions.transactionalClient(
      'ProjectMemberRepository.capToViewer',
    );
    // Versão incrementada: um PATCH concorrente com a versão antiga recebe 409 e recarrega.
    const { count } = await transaction.projectMember.updateMany({
      where: { organizationId, userId, role: { not: 'viewer' } },
      data: { role: 'viewer', updatedAt: now, version: { increment: 1 } },
    });
    return count;
  }
}
