import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import { RateLimitedError } from '@taskflow/backend/shared/application';
import { canOnProject } from '@taskflow/backend/shared/kernel';
import {
  findStatus,
  InvalidPositionError,
  keyBetween,
  needsRebalance,
  TaskNotACardError,
  type RankedCard,
  type Task,
  type WorkflowView,
} from '@taskflow/backend/tasks/domain';
import { applyTransition } from '../shared/apply-transition';
import { decodeColumnCursor, encodeColumnCursor } from '../shared/board-cursor';
import { lockTaskForWrite } from '../shared/task-access';
import {
  BOARD_DEFAULT_CARDS,
  BOARD_MAX_CARDS,
  COLUMN_DEFAULT_CARDS,
  COLUMN_MAX_CARDS,
  TASK_REBALANCE_POLICY,
  TASK_WRITE_POLICY,
} from '../shared/task-limits';
import { assigneesOf, toTaskSummaryView, type TaskSummaryView } from '../shared/task-views';
import { assertWritable, eventBase, reloadTask, runTaskMutation } from '../shared/task-write';
import type { TasksDependencies } from '../shared/tasks-dependencies';
import { ProjectNotFoundError, StatusNotFoundError } from '../shared/tasks-errors';
import type { TasksEvent } from '../shared/tasks-events';

/** Card do quadro: resumo da tarefa e subtarefas sem as canceladas. */
export type CardView = TaskSummaryView &
  Readonly<{ subtasks: Readonly<{ done: number; total: number }> }>;

export type ColumnView = Readonly<{
  statusId: string;
  cards: ReadonlyArray<CardView>;
  nextCursor: string | null;
}>;

export type BoardView = Readonly<{
  statuses: WorkflowView['statuses'];
  transitions: WorkflowView['transitions'];
  columns: ReadonlyArray<ColumnView>;
  /** Capacidades do leitor no quadro (dica de interface; a API decide). */
  actions: Readonly<{ move: boolean; configure: boolean }>;
}>;

const clamp = (value: number | undefined, fallback: number, max: number) =>
  Math.min(Math.max(Math.trunc(value ?? fallback), 1), max);

const ordered = (workflow: WorkflowView) =>
  [...workflow.statuses].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));

/** Nomes e contagens de subtarefas de uma lista de tarefas: duas chamadas, qualquer tamanho. */
async function toCards(
  deps: Pick<TasksDependencies, 'tasks' | 'users'>,
  organizationId: string,
  project: Readonly<{ projectId: string; key: string; workflow: WorkflowView }>,
  tasks: ReadonlyArray<Task>,
): Promise<CardView[]> {
  const ids = tasks.map((task) => task.id);
  const [names, counts] = await Promise.all([
    deps.users.getNames(assigneesOf(tasks)),
    deps.tasks.subtaskCounts(organizationId, project.projectId, ids),
  ]);
  return tasks.map((task) => ({
    ...toTaskSummaryView(task, project, names),
    subtasks: counts.get(task.id) ?? { done: 0, total: 0 },
  }));
}

/** Página de uma coluna com o cursor do último card. */
async function columnOf(
  deps: Pick<TasksDependencies, 'tasks'>,
  organizationId: string,
  projectId: string,
  statusId: string,
  limit: number,
  after: RankedCard | null,
) {
  const page = await deps.tasks.columnPage(organizationId, projectId, statusId, { limit, after });
  const last = page.items.at(-1);
  return {
    tasks: page.items.map((item) => item.task),
    nextCursor:
      page.hasMore && last
        ? encodeColumnCursor(statusId, { id: last.task.id, rank: last.rank })
        : null,
  };
}

/**
 * RF-01, RF-04: o quadro do projeto — uma coluna por status, cards de primeiro nível não
 * cancelados por `(rank, id)`. Consultas: uma por coluna (≤ 20) + nomes + contagens.
 */
export class GetBoardUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  async execute(
    context: TenantRequestContext,
    query: Readonly<{ projectId: string; limit?: number }>,
  ): Promise<BoardView> {
    const { organizationId, organizationRole } = context.tenant;
    const project = await this.deps.projectAccess.resolveForRead(
      organizationId,
      { projectId: query.projectId },
      { userId: context.actor.userId, organizationRole },
    );
    if (!project) throw new ProjectNotFoundError();
    const limit = clamp(query.limit, BOARD_DEFAULT_CARDS, BOARD_MAX_CARDS);
    const statuses = ordered(project.workflow);
    const pages = await Promise.all(
      statuses.map((status) =>
        columnOf(this.deps, organizationId, project.projectId, status.id, limit, null),
      ),
    );
    const cards = await toCards(
      this.deps,
      organizationId,
      project,
      pages.flatMap((page) => page.tasks),
    );
    const byId = new Map(cards.map((card) => [card.id, card]));
    const may = (permission: 'task:update' | 'board:configure') =>
      canOnProject(project.effectiveRole, permission, { ownsResource: false }) && !project.archived;
    return {
      statuses,
      transitions: project.workflow.transitions,
      columns: statuses.map((status, index) => ({
        statusId: status.id,
        cards: (pages[index]?.tasks ?? []).flatMap((task) => byId.get(task.id) ?? []),
        nextCursor: pages[index]?.nextCursor ?? null,
      })),
      actions: { move: may('task:update'), configure: may('board:configure') },
    };
  }
}

/** RF-01: mais cards de uma coluna ("carregar mais"). */
export class ListColumnCardsUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  async execute(
    context: TenantRequestContext,
    query: Readonly<{
      projectId: string;
      statusId: string;
      cursor?: string | null;
      limit?: number;
    }>,
  ): Promise<Readonly<{ cards: ReadonlyArray<CardView>; nextCursor: string | null }>> {
    const { organizationId, organizationRole } = context.tenant;
    const project = await this.deps.projectAccess.resolveForRead(
      organizationId,
      { projectId: query.projectId },
      { userId: context.actor.userId, organizationRole },
    );
    if (!project) throw new ProjectNotFoundError();
    // A coluna só existe no workflow do projeto já resolvido (B2 da segurança).
    if (!findStatus(project.workflow, query.statusId)) throw new StatusNotFoundError();
    const after = decodeColumnCursor(query.cursor ?? null, query.statusId);
    const page = await columnOf(
      this.deps,
      organizationId,
      project.projectId,
      query.statusId,
      clamp(query.limit, COLUMN_DEFAULT_CARDS, COLUMN_MAX_CARDS),
      after,
    );
    return {
      cards: await toCards(this.deps, organizationId, project, page.tasks),
      nextCursor: page.nextCursor,
    };
  }
}

export type MoveCardCommand = Readonly<{
  taskId: string;
  toStatusId: string;
  afterTaskId?: string;
  beforeTaskId?: string;
  version: number;
}>;

export type MoveCardOutcome = Readonly<{
  card: CardView;
  statusId: string;
}>;

/**
 * RF-02/RF-03 (BR-009, BR-004, BR-001, BR-006, BR-010): reordena ou muda de coluna numa transação.
 * Sempre sob o lock do projeto em `tasks` (D3). Ordem de decisão: 404 → 403 → arquivado →
 * cancelada → versão → `TASK_NOT_A_CARD` → `STATUS_NOT_FOUND` → `INVALID_POSITION` → regras.
 */
export class MoveCardUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  execute(context: TenantRequestContext, command: MoveCardCommand): Promise<MoveCardOutcome> {
    return runTaskMutation(this.deps, context, TASK_WRITE_POLICY, () =>
      this.moveWithinTransaction(context, command),
    );
  }

  async moveWithinTransaction(
    context: TenantRequestContext,
    command: MoveCardCommand,
  ): Promise<Readonly<{ result: MoveCardOutcome; events: ReadonlyArray<TasksEvent> }>> {
    const { organizationId } = context.tenant;
    const { task, project } = await lockTaskForWrite(this.deps, context, command.taskId, {
      authorize: (role) => canOnProject(role, 'task:update', { ownsResource: false }),
      lockProject: true,
    });
    assertWritable(task, command.version);
    if (task.parentTaskId !== null) throw new TaskNotACardError();
    const target = findStatus(project.workflow, command.toStatusId);
    if (!target) throw new StatusNotFoundError();
    const { projectId } = project;

    let rank = await this.rankFor(organizationId, projectId, target.id, task.id, command);
    if (rank === null || needsRebalance(rank)) {
      await this.rebalance(context, projectId, target.id);
      rank = await this.rankFor(organizationId, projectId, target.id, task.id, command);
      if (rank === null) throw new Error('Rank still tied after rebalancing');
    }
    const from = task.statusId;
    const events: TasksEvent[] = [];
    if (target.id !== from) {
      events.push(await applyTransition(this.deps, context, task, project.workflow, target));
    }
    await this.deps.tasks.placeCard(organizationId, projectId, task.id, rank);
    events.push({
      ...eventBase(context, task),
      type: 'tasks.card_moved',
      fromStatusId: from,
      toStatusId: target.id,
    });
    const saved = await reloadTask(this.deps, organizationId, task);
    const [card] = await toCards(this.deps, organizationId, project, [saved]);
    if (!card) throw new Error('Moved card vanished');
    return { result: { card, statusId: target.id }, events };
  }

  /**
   * Chave entre o par (anterior, sucessor) da coluna destino, sem o próprio card. `null` se o par
   * estiver empatado (B2): quem chama rebalanceia e tenta de novo. Vizinho que não é card da
   * coluna ⇒ `INVALID_POSITION`, com o mesmo corpo para qualquer motivo.
   */
  private async rankFor(
    organizationId: string,
    projectId: string,
    statusId: string,
    taskId: string,
    command: MoveCardCommand,
  ): Promise<string | null> {
    const tasks = this.deps.tasks;
    const anchorId = command.afterTaskId ?? command.beforeTaskId;
    let previous: string | null;
    let next: string | null;
    if (anchorId === undefined) {
      previous = await tasks.lastRankInColumn(organizationId, projectId, statusId, taskId);
      next = null;
    } else {
      const anchor =
        anchorId === taskId
          ? null
          : await tasks.cardInColumn(organizationId, projectId, statusId, anchorId);
      if (!anchor) throw new InvalidPositionError();
      const direction = command.afterTaskId !== undefined ? 'next' : 'previous';
      const other = await tasks.adjacentCard(
        organizationId,
        projectId,
        statusId,
        anchor,
        direction,
        taskId,
      );
      previous = direction === 'next' ? anchor.rank : (other?.rank ?? null);
      next = direction === 'next' ? (other?.rank ?? null) : anchor.rank;
    }
    if (previous !== null && next !== null && previous >= next) return null;
    return keyBetween(previous, next);
  }

  /** M1 da segurança: rebalanceamento limitado por projeto (raro pelo esquema de chaves). */
  private async rebalance(
    context: TenantRequestContext,
    projectId: string,
    statusId: string,
  ): Promise<void> {
    const decision = await this.deps.rateLimiter.consume(TASK_REBALANCE_POLICY, projectId);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
    await this.deps.tasks.rebalanceColumn(context.tenant.organizationId, projectId, statusId);
  }
}

/** Para a porta `WorkflowStatusUsage` de `projects` (fundação; só repositórios). */
export class CountTasksByStatusUseCase {
  constructor(private readonly deps: Pick<TasksDependencies, 'tasks'>) {}

  execute(organizationId: string, projectId: string): Promise<ReadonlyMap<string, number>> {
    return this.deps.tasks.countByStatus(organizationId, projectId);
  }
}

/**
 * Para a porta `WorkflowStatusUsage`: reatribui **todas** as tarefas (canceladas e subtarefas
 * incluídas) de um status removido, na transação de `projects` (projeto travado). Mesma
 * categoria (D2): nenhuma tarefa entra ou sai de `done`; a chave é mantida (I3).
 */
export class ReassignTasksStatusUseCase {
  constructor(private readonly deps: Pick<TasksDependencies, 'tasks' | 'clock'>) {}

  execute(
    organizationId: string,
    projectId: string,
    fromStatusId: string,
    toStatusId: string,
  ): Promise<number> {
    return this.deps.tasks.reassignStatus(
      organizationId,
      projectId,
      fromStatusId,
      toStatusId,
      this.deps.clock.now(),
    );
  }
}
