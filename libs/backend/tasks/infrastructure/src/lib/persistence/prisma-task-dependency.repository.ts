import { TaskNotFoundError, type TaskDependencyRepository } from '@taskflow/backend/tasks/domain';
import {
  isForeignKeyViolation,
  type PrismaTransactionRunner,
} from '@taskflow/backend/shared/infrastructure';

/** Dependências "bloqueada por" sempre filtradas por organização e projeto. */
export class PrismaTaskDependencyRepository implements TaskDependencyRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async add(
    organizationId: string,
    projectId: string,
    blockedTaskId: string,
    blockingTaskId: string,
  ): Promise<boolean> {
    const client = this.transactions.client();
    // Checagem antes de inserir (sob o lock do projeto em `tasks`): um P2002 abortaria a transação.
    const existing = await client.taskDependency.findFirst({
      where: { organizationId, projectId, blockedTaskId, blockingTaskId },
      select: { blockedTaskId: true },
    });
    if (existing) return false;
    try {
      await client.taskDependency.create({
        data: { organizationId, projectId, blockedTaskId, blockingTaskId, createdAt: new Date() },
      });
      return true;
    } catch (error) {
      // Tarefa apagada no meio (corrida com exclusão).
      if (isForeignKeyViolation(error)) throw new TaskNotFoundError();
      throw error;
    }
  }

  async remove(
    organizationId: string,
    projectId: string,
    blockedTaskId: string,
    blockingTaskId: string,
  ): Promise<boolean> {
    const { count } = await this.transactions.client().taskDependency.deleteMany({
      where: { organizationId, projectId, blockedTaskId, blockingTaskId },
    });
    return count > 0;
  }

  async blockersOf(
    organizationId: string,
    projectId: string,
    taskIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<string>> {
    if (taskIds.length === 0) return [];
    const rows = await this.transactions.client().taskDependency.findMany({
      where: { organizationId, projectId, blockedTaskId: { in: [...taskIds] } },
      select: { blockingTaskId: true },
    });
    return rows.map((row) => row.blockingTaskId);
  }

  async blockedBy(
    organizationId: string,
    projectId: string,
    blockingTaskId: string,
    limit: number,
  ): Promise<ReadonlyArray<string>> {
    const rows = await this.transactions.client().taskDependency.findMany({
      where: { organizationId, projectId, blockingTaskId },
      orderBy: { createdAt: 'asc' },
      select: { blockedTaskId: true },
      take: limit,
    });
    return rows.map((row) => row.blockedTaskId);
  }

  countBlockers(organizationId: string, projectId: string, blockedTaskId: string): Promise<number> {
    return this.transactions
      .client()
      .taskDependency.count({ where: { organizationId, projectId, blockedTaskId } });
  }

  countInProject(organizationId: string, projectId: string): Promise<number> {
    return this.transactions
      .client()
      .taskDependency.count({ where: { organizationId, projectId } });
  }
}
