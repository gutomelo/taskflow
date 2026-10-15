import { VersionConflictError } from '@taskflow/backend/shared/kernel';
import {
  spreadKeys,
  TaskNotFoundError,
  type Page,
  type PageRequest,
  type RankedCard,
  type RevocationScope,
  type SubtaskCount,
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
/** Cards da coluna: tarefas de primeiro nível não canceladas do status (spec 005). */
const cardsOf = (organizationId: string, projectId: string, statusId: string) => ({
  organizationId,
  projectId,
  statusId,
  parentTaskId: null,
  canceledAt: null,
});

/** Depois de `card` na ordem `(rank, id)` (comparação em collation "C"). */
const afterCard = (card: RankedCard) => ({
  OR: [{ boardRank: { gt: card.rank } }, { boardRank: card.rank, id: { gt: card.id } }],
});
const beforeCard = (card: RankedCard) => ({
  OR: [{ boardRank: { lt: card.rank } }, { boardRank: card.rank, id: { lt: card.id } }],
});

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

  async add(task: Task, boardRank: string): Promise<void> {
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
          boardRank,
          ...writableColumns(task),
        },
      });
    } catch (error) {
      // Pai apagado no meio (corrida com exclusão): o mesmo 404 da referência inexistente.
      if (isForeignKeyViolation(error)) throw new TaskNotFoundError();
      throw error;
    }
  }

  async lastRankInColumn(
    organizationId: string,
    projectId: string,
    statusId: string,
    exceptTaskId?: string,
  ): Promise<string | null> {
    const row = await this.transactions.client().task.findFirst({
      where: {
        ...cardsOf(organizationId, projectId, statusId),
        ...(exceptTaskId ? { id: { not: exceptTaskId } } : {}),
      },
      orderBy: [{ boardRank: 'desc' }, { id: 'desc' }],
      select: { boardRank: true },
    });
    return row?.boardRank ?? null;
  }

  async columnPage(
    organizationId: string,
    projectId: string,
    statusId: string,
    { limit, after }: Readonly<{ limit: number; after: RankedCard | null }>,
  ) {
    const rows = await this.transactions.client().task.findMany({
      where: {
        ...cardsOf(organizationId, projectId, statusId),
        ...(after ? afterCard(after) : {}),
      },
      orderBy: [{ boardRank: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    return {
      items: rows.slice(0, limit).map((row) => ({ task: toTask(row), rank: row.boardRank })),
      hasMore: rows.length > limit,
    };
  }

  async subtaskCounts(
    organizationId: string,
    projectId: string,
    parentTaskIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, SubtaskCount>> {
    if (parentTaskIds.length === 0) return new Map();
    const where = {
      organizationId,
      projectId,
      parentTaskId: { in: [...parentTaskIds] },
      canceledAt: null,
    };
    const client = this.transactions.client();
    const [total, done] = await Promise.all([
      client.task.groupBy({ by: ['parentTaskId'], where, _count: { _all: true } }),
      client.task.groupBy({
        by: ['parentTaskId'],
        where: { ...where, completedAt: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const doneBy = new Map(done.map((row) => [row.parentTaskId, row._count._all]));
    const counts = new Map<string, SubtaskCount>();
    for (const row of total) {
      if (row.parentTaskId === null) continue;
      counts.set(row.parentTaskId, {
        total: row._count._all,
        done: doneBy.get(row.parentTaskId) ?? 0,
      });
    }
    return counts;
  }

  async cardInColumn(
    organizationId: string,
    projectId: string,
    statusId: string,
    taskId: string,
  ): Promise<RankedCard | null> {
    const row = await this.transactions.client().task.findFirst({
      where: { ...cardsOf(organizationId, projectId, statusId), id: taskId },
      select: { id: true, boardRank: true },
    });
    return row ? { id: row.id, rank: row.boardRank } : null;
  }

  async adjacentCard(
    organizationId: string,
    projectId: string,
    statusId: string,
    card: RankedCard,
    direction: 'next' | 'previous',
    exceptTaskId: string,
  ): Promise<RankedCard | null> {
    const order = direction === 'next' ? 'asc' : 'desc';
    const row = await this.transactions.client().task.findFirst({
      where: {
        ...cardsOf(organizationId, projectId, statusId),
        id: { not: exceptTaskId },
        ...(direction === 'next' ? afterCard(card) : beforeCard(card)),
      },
      orderBy: [{ boardRank: order }, { id: order }],
      select: { id: true, boardRank: true },
    });
    return row ? { id: row.id, rank: row.boardRank } : null;
  }

  async placeCard(
    organizationId: string,
    projectId: string,
    taskId: string,
    rank: string,
  ): Promise<void> {
    await this.transactions.client().task.updateMany({
      where: { organizationId, projectId, id: taskId },
      data: { boardRank: rank },
    });
  }

  async rebalanceColumn(organizationId: string, projectId: string, statusId: string) {
    const transaction = this.transactions.transactionalClient('TaskRepository.rebalanceColumn');
    // Linhas da coluna travadas em ordem de `id` (ordem determinística entre escritores de várias
    // linhas); a nova ordem segue `(rank, id)` atual.
    await transaction.$queryRaw`
      SELECT id FROM tasks
      WHERE organization_id = ${organizationId}::uuid AND project_id = ${projectId}::uuid
        AND status_id = ${statusId}::uuid AND parent_task_id IS NULL AND canceled_at IS NULL
      ORDER BY id
      FOR NO KEY UPDATE`;
    const rows = await transaction.task.findMany({
      where: cardsOf(organizationId, projectId, statusId),
      orderBy: [{ boardRank: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (rows.length === 0) return 0;
    const ids = rows.map((row) => row.id);
    const ranks = spreadKeys(rows.length);
    // ADR 0007: escrita raw tenant-scoped avaliada contra o gatilho do ADR 0014 — um comando,
    // parametrizado, filtrado por organização, projeto e status no próprio WHERE.
    return transaction.$executeRaw`
      UPDATE tasks AS t SET board_rank = v.rank
      FROM unnest(${ids}::uuid[], ${ranks}::text[]) AS v(id, rank)
      WHERE t.organization_id = ${organizationId}::uuid AND t.project_id = ${projectId}::uuid
        AND t.status_id = ${statusId}::uuid AND t.id = v.id`;
  }

  async countByStatus(
    organizationId: string,
    projectId: string,
  ): Promise<ReadonlyMap<string, number>> {
    const rows = await this.transactions.client().task.groupBy({
      by: ['statusId'],
      where: { organizationId, projectId },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.statusId, row._count._all]));
  }

  async reassignStatus(
    organizationId: string,
    projectId: string,
    fromStatusId: string,
    toStatusId: string,
    now: Date,
  ): Promise<number> {
    const { count } = await this.transactions.client().task.updateMany({
      where: { organizationId, projectId, statusId: fromStatusId },
      data: { statusId: toStatusId, version: { increment: 1 }, updatedAt: now },
    });
    return count;
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

  async lockForShare(
    organizationId: string,
    projectId: string,
    taskId: string,
  ): Promise<Task | null> {
    const transaction = this.transactions.transactionalClient('TaskRepository.lockForShare');
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM tasks
      WHERE organization_id = ${organizationId}::uuid AND project_id = ${projectId}::uuid
        AND id = ${taskId}::uuid
      FOR SHARE`;
    if (locked.length === 0) return null;
    const row = await transaction.task.findUnique({
      where: { organizationId_projectId_id: { organizationId, projectId, id: taskId } },
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
        // E lógico entre "sem responsável" e "de uma pessoa" (um spread sobrescreveria o outro).
        AND: [
          ...(filter.unassigned ? [{ assigneeUserId: null }] : []),
          ...(filter.assigneeUserId === undefined
            ? []
            : [{ assigneeUserId: filter.assigneeUserId }]),
        ],
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

  async findAnyByIds(
    organizationId: string,
    taskIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<Task>> {
    if (taskIds.length === 0) return [];
    const rows = await this.transactions.client().task.findMany({
      where: { organizationId, id: { in: [...taskIds] } },
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
