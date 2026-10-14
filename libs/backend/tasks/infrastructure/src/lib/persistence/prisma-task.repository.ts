import { VersionConflictError } from '@taskflow/backend/shared/kernel';
import {
  TaskNotFoundError,
  type Page,
  type PageRequest,
  type RevocationScope,
  type Task,
  type TaskFilter,
  type TaskRepository,
} from '@taskflow/backend/tasks/domain';
import {
  isForeignKeyViolation,
  type PrismaTransactionRunner,
} from '@taskflow/backend/shared/infrastructure';
import { decodeCursor, encodeCursor } from './number-cursor';
import { toTask, writableColumns } from './tasks-mappers';

/**
 * Toda operação aplica `organizationId` (e `projectId` quando conhecido) em leitura **e** escrita.
 * Escritas de uma tarefa tocam uma linha só (design, concorrência).
 */
export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async nextNumber(organizationId: string, projectId: string): Promise<number> {
    const transaction = this.transactions.transactionalClient('TaskRepository.nextNumber');
    // `upsert` nativo (INSERT … ON CONFLICT DO UPDATE): atômico e serializado pela linha.
    const counter = await transaction.taskCounter.upsert({
      where: { organizationId_projectId: { organizationId, projectId } },
      create: { organizationId, projectId, nextNumber: 2 },
      update: { nextNumber: { increment: 1 } },
    });
    return counter.nextNumber - 1;
  }

  async lockProject(organizationId: string, projectId: string): Promise<void> {
    const transaction = this.transactions.transactionalClient('TaskRepository.lockProject');
    // `upsert` nativo (`INSERT … ON CONFLICT DO UPDATE`): a linha fica travada até o commit, tanto
    // quando é criada quanto quando já existia — é o próprio lock (sem SQL raw). `update` não
    // vazio de propósito: com `update: {}` o Prisma faz "procura e cria", que corre.
    await transaction.taskProjectLock.upsert({
      where: { organizationId_projectId: { organizationId, projectId } },
      create: { organizationId, projectId },
      update: { organizationId },
    });
  }

  async add(task: Task): Promise<void> {
    const { id, organizationId, projectId, number, parentTaskId, createdByUserId, createdAt } =
      task.toSnapshot();
    try {
      await this.transactions.client().task.create({
        data: {
          id,
          organizationId,
          projectId,
          number,
          parentTaskId,
          createdByUserId,
          createdAt,
          ...writableColumns(task),
        },
      });
    } catch (error) {
      // Pai apagado no meio (corrida com exclusão): o mesmo 404 da referência inexistente.
      if (isForeignKeyViolation(error)) throw new TaskNotFoundError();
      throw error;
    }
  }

  async findById(organizationId: string, taskId: string): Promise<Task | null> {
    const row = await this.transactions
      .client()
      .task.findFirst({ where: { organizationId, id: taskId } });
    return row ? toTask(row) : null;
  }

  async findByNumber(
    organizationId: string,
    projectId: string,
    number: number,
  ): Promise<Task | null> {
    const row = await this.transactions.client().task.findUnique({
      where: { organizationId_projectId_number: { organizationId, projectId, number } },
    });
    return row ? toTask(row) : null;
  }

  async lockById(organizationId: string, projectId: string, taskId: string): Promise<Task | null> {
    const transaction = this.transactions.transactionalClient('TaskRepository.lockById');
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM tasks
      WHERE organization_id = ${organizationId}::uuid AND project_id = ${projectId}::uuid
        AND id = ${taskId}::uuid
      FOR NO KEY UPDATE`;
    if (locked.length === 0) return null;
    const row = await transaction.task.findUnique({
      where: { organizationId_projectId_id: { organizationId, projectId, id: taskId } },
    });
    return row ? toTask(row) : null;
  }

  async save(task: Task): Promise<void> {
    const { organizationId, projectId, id, version } = task.toSnapshot();
    const { count } = await this.transactions.client().task.updateMany({
      where: { organizationId, projectId, id, version },
      data: { ...writableColumns(task), version: { increment: 1 } },
    });
    if (count === 0) throw new VersionConflictError('Task');
  }

  async remove(
    organizationId: string,
    projectId: string,
    taskId: string,
    version: number,
  ): Promise<void> {
    const { count } = await this.transactions.client().task.deleteMany({
      where: { organizationId, projectId, id: taskId, version },
    });
    if (count === 0) throw new VersionConflictError('Task');
  }

  async listPage(
    organizationId: string,
    projectId: string,
    filter: TaskFilter,
    { limit, cursor }: PageRequest,
  ): Promise<Page<Task>> {
    const before = decodeCursor(cursor);
    const rows = await this.transactions.client().task.findMany({
      where: {
        organizationId,
        projectId,
        parentTaskId: filter.parentTaskId,
        ...(filter.includeCanceled ? {} : { canceledAt: null }),
        ...(filter.statusId === undefined ? {} : { statusId: filter.statusId }),
        ...(filter.priority === undefined ? {} : { priority: filter.priority }),
        ...(filter.unassigned ? { assigneeUserId: null } : {}),
        ...(filter.assigneeUserId === undefined ? {} : { assigneeUserId: filter.assigneeUserId }),
        ...(before === null ? {} : { number: { lt: before } }),
      },
      orderBy: { number: 'desc' },
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(toTask),
      nextCursor: rows.length > limit && last ? encodeCursor(last.number) : null,
    };
  }

  async subtasksOf(
    organizationId: string,
    projectId: string,
    parentTaskId: string,
  ): Promise<ReadonlyArray<Task>> {
    const rows = await this.transactions.client().task.findMany({
      where: { organizationId, projectId, parentTaskId },
      orderBy: { number: 'asc' },
    });
    return rows.map(toTask);
  }

  async findByIds(
    organizationId: string,
    projectId: string,
    taskIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<Task>> {
    if (taskIds.length === 0) return [];
    const rows = await this.transactions.client().task.findMany({
      where: { organizationId, projectId, id: { in: [...taskIds] } },
      orderBy: { number: 'asc' },
    });
    return rows.map(toTask);
  }

  async requiredSubtaskIds(
    organizationId: string,
    projectId: string,
    parentTaskIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<string>> {
    if (parentTaskIds.length === 0) return [];
    const rows = await this.transactions.client().task.findMany({
      where: {
        organizationId,
        projectId,
        parentTaskId: { in: [...parentTaskIds] },
        isRequired: true,
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  countInOrganization(organizationId: string): Promise<number> {
    return this.transactions.client().task.count({ where: { organizationId } });
  }

  async revokeAssignments(
    organizationId: string,
    userId: string,
    scope: RevocationScope,
    now: Date,
  ): Promise<number> {
    const transaction = this.transactions.transactionalClient('TaskRepository.revokeAssignments');
    const { count } = await transaction.task.updateMany({
      where: {
        organizationId,
        assigneeUserId: userId,
        ...(scope.kind === 'project'
          ? { projectId: scope.projectId }
          : { projectId: { notIn: [...scope.exceptProjectIds] } }),
      },
      data: { assigneeUserId: null, updatedAt: now, version: { increment: 1 } },
    });
    return count;
  }
}
