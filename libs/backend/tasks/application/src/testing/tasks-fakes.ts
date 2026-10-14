// Fakes em memória para os testes de casos de uso de `tasks`. Nunca em produção.
import {
  effectiveProjectRole,
  VersionConflictError,
  type OrganizationRole,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import {
  FakeTransactionRunner,
  FixedClock,
  InMemoryRateLimiter,
  SequentialIds,
  type TransactionalStore,
} from '@taskflow/backend/shared/application/testing';
import {
  spreadKeys,
  Task,
  type Page,
  type PageRequest,
  type RankedCard,
  type RevocationScope,
  type SubtaskCount,
  type TaskDependencyRepository,
  type TaskFilter,
  type TaskRepository,
  type TaskSnapshot,
  type WorkflowView,
} from '@taskflow/backend/tasks/domain';
import type {
  AssignableUser,
  LockedProject,
  ProjectAccess,
  ProjectLookup,
  ReadableProject,
} from '../lib/ports/project-access';
import type { TaskUserDirectory } from '../lib/ports/user-directory';
import type { TasksEvent, TasksEventRecorder } from '../lib/shared/tasks-events';

function requireTransaction(transactions: FakeTransactionRunner, operation: string): void {
  if (!transactions.inTransaction) throw new Error(`${operation} must run inside a transaction`);
}

/** Ordem `(rank, id)` por código (como a collation "C"). */
function compareCards(a: RankedCard, b: RankedCard): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function pageOf<T>(all: ReadonlyArray<T>, page: PageRequest): Page<T> {
  const start = page.cursor === null ? 0 : Number(page.cursor);
  const next = start + page.limit;
  return { items: all.slice(start, next), nextCursor: next < all.length ? String(next) : null };
}

export class InMemoryTaskRepository implements TaskRepository, TransactionalStore {
  rows: TaskSnapshot[] = [];
  counters = new Map<string, number>();
  /** Projetos travados (lock de invariantes entre tarefas). */
  readonly projectLocks: string[] = [];
  /** Tarefas travadas (`lockById`). */
  readonly taskLocks: string[] = [];
  /** Posição de cada tarefa no quadro (fora do agregado, como no banco). */
  ranks = new Map<string, string>();

  constructor(private readonly transactions: FakeTransactionRunner) {}

  snapshot() {
    return { rows: [...this.rows], counters: new Map(this.counters), ranks: new Map(this.ranks) };
  }
  restore(state: unknown) {
    const saved = state as {
      rows: TaskSnapshot[];
      counters: Map<string, number>;
      ranks: Map<string, string>;
    };
    this.rows = saved.rows;
    this.counters = saved.counters;
    this.ranks = saved.ranks;
  }

  private in(organizationId: string, projectId?: string) {
    return this.rows.filter(
      (row) =>
        row.organizationId === organizationId &&
        (projectId === undefined || row.projectId === projectId),
    );
  }

  async nextNumber(organizationId: string, projectId: string) {
    requireTransaction(this.transactions, 'TaskRepository.nextNumber');
    const key = `${organizationId}|${projectId}`;
    const next = (this.counters.get(key) ?? 1) + 1;
    this.counters.set(key, next);
    return next - 1;
  }
  async lockProject(organizationId: string, projectId: string) {
    requireTransaction(this.transactions, 'TaskRepository.lockProject');
    this.projectLocks.push(projectId);
  }
  async add(task: Task, boardRank: string) {
    this.rows.push(task.toSnapshot());
    this.ranks.set(task.id, boardRank);
  }
  private cards(organizationId: string, projectId: string, statusId: string) {
    return this.in(organizationId, projectId)
      .filter(
        (row) => row.statusId === statusId && row.parentTaskId === null && row.canceledAt === null,
      )
      .map((row) => ({ row, rank: this.ranks.get(row.id) ?? '' }))
      .sort((a, b) => compareCards({ id: a.row.id, rank: a.rank }, { id: b.row.id, rank: b.rank }));
  }
  async lastRankInColumn(
    organizationId: string,
    projectId: string,
    statusId: string,
    exceptTaskId?: string,
  ) {
    const cards = this.cards(organizationId, projectId, statusId).filter(
      (card) => card.row.id !== exceptTaskId,
    );
    return cards.at(-1)?.rank ?? null;
  }
  async columnPage(
    organizationId: string,
    projectId: string,
    statusId: string,
    page: Readonly<{ limit: number; after: RankedCard | null }>,
  ) {
    const { after } = page;
    const rest = this.cards(organizationId, projectId, statusId).filter(
      (card) => !after || compareCards({ id: card.row.id, rank: card.rank }, after) > 0,
    );
    return {
      items: rest
        .slice(0, page.limit)
        .map((card) => ({ task: Task.restore(card.row), rank: card.rank })),
      hasMore: rest.length > page.limit,
    };
  }
  /** Consultas de contagem feitas (prova de número fixo de consultas por página). */
  subtaskCountCalls = 0;
  async subtaskCounts(
    organizationId: string,
    projectId: string,
    parentTaskIds: ReadonlyArray<string>,
  ) {
    this.subtaskCountCalls += 1;
    const counts = new Map<string, SubtaskCount>();
    for (const row of this.in(organizationId, projectId)) {
      if (row.parentTaskId === null || row.canceledAt !== null) continue;
      if (!parentTaskIds.includes(row.parentTaskId)) continue;
      const current = counts.get(row.parentTaskId) ?? { done: 0, total: 0 };
      counts.set(row.parentTaskId, {
        total: current.total + 1,
        done: current.done + (row.completedAt ? 1 : 0),
      });
    }
    return counts;
  }
  async cardInColumn(organizationId: string, projectId: string, statusId: string, taskId: string) {
    const card = this.cards(organizationId, projectId, statusId).find(
      (item) => item.row.id === taskId,
    );
    return card ? { id: card.row.id, rank: card.rank } : null;
  }
  async adjacentCard(
    organizationId: string,
    projectId: string,
    statusId: string,
    card: RankedCard,
    direction: 'next' | 'previous',
    exceptTaskId: string,
  ) {
    const cards = this.cards(organizationId, projectId, statusId)
      .filter((item) => item.row.id !== exceptTaskId)
      .map((item) => ({ id: item.row.id, rank: item.rank }));
    return direction === 'next'
      ? (cards.find((item) => compareCards(item, card) > 0) ?? null)
      : ([...cards].reverse().find((item) => compareCards(item, card) < 0) ?? null);
  }
  /** Posições gravadas (`placeCard`), na ordem. */
  readonly placements: Array<{ taskId: string; rank: string }> = [];
  async placeCard(organizationId: string, projectId: string, taskId: string, rank: string) {
    if (this.in(organizationId, projectId).some((row) => row.id === taskId)) {
      this.ranks.set(taskId, rank);
      this.placements.push({ taskId, rank });
    }
  }
  readonly rebalances: string[] = [];
  async rebalanceColumn(organizationId: string, projectId: string, statusId: string) {
    requireTransaction(this.transactions, 'TaskRepository.rebalanceColumn');
    const cards = this.cards(organizationId, projectId, statusId);
    const keys = spreadKeys(cards.length);
    cards.forEach((card, index) => this.ranks.set(card.row.id, keys[index] ?? ''));
    this.rebalances.push(statusId);
    return cards.length;
  }
  async countByStatus(organizationId: string, projectId: string) {
    const counts = new Map<string, number>();
    for (const row of this.in(organizationId, projectId)) {
      counts.set(row.statusId, (counts.get(row.statusId) ?? 0) + 1);
    }
    return counts;
  }
  async reassignStatus(
    organizationId: string,
    projectId: string,
    fromStatusId: string,
    toStatusId: string,
    now: Date,
  ) {
    let count = 0;
    this.rows = this.rows.map((row) => {
      if (row.organizationId !== organizationId || row.projectId !== projectId) return row;
      if (row.statusId !== fromStatusId) return row;
      count += 1;
      return { ...row, statusId: toStatusId, version: row.version + 1, updatedAt: now };
    });
    return count;
  }
  async findById(organizationId: string, taskId: string) {
    const row = this.in(organizationId).find((candidate) => candidate.id === taskId);
    return row ? Task.restore(row) : null;
  }
  async findByNumber(organizationId: string, projectId: string, number: number) {
    const row = this.in(organizationId, projectId).find((candidate) => candidate.number === number);
    return row ? Task.restore(row) : null;
  }
  async lockById(organizationId: string, projectId: string, taskId: string) {
    requireTransaction(this.transactions, 'TaskRepository.lockById');
    this.taskLocks.push(taskId);
    const row = this.in(organizationId, projectId).find((candidate) => candidate.id === taskId);
    return row ? Task.restore(row) : null;
  }
  async save(task: Task) {
    const row = task.toSnapshot();
    const at = this.rows.findIndex(
      (candidate) =>
        candidate.organizationId === row.organizationId &&
        candidate.projectId === row.projectId &&
        candidate.id === row.id,
    );
    if (at < 0 || this.rows[at]?.version !== row.version) throw new VersionConflictError('Task');
    this.rows[at] = { ...row, version: row.version + 1 };
  }
  async remove(organizationId: string, projectId: string, taskId: string, version: number) {
    const target = this.in(organizationId, projectId).find((row) => row.id === taskId);
    if (!target || target.version !== version) throw new VersionConflictError('Task');
    // Cascata: subtarefas (FK do pai).
    this.rows = this.rows.filter((row) => row.id !== taskId && row.parentTaskId !== taskId);
  }
  async listPage(organizationId: string, projectId: string, filter: TaskFilter, page: PageRequest) {
    const all = this.in(organizationId, projectId)
      .filter(
        (row) =>
          row.parentTaskId === filter.parentTaskId &&
          (filter.includeCanceled || row.canceledAt === null) &&
          (filter.statusId === undefined || row.statusId === filter.statusId) &&
          (filter.priority === undefined || row.priority === filter.priority) &&
          (!filter.unassigned || row.assigneeUserId === null) &&
          (filter.assigneeUserId === undefined || row.assigneeUserId === filter.assigneeUserId),
      )
      .sort((a, b) => b.number - a.number);
    const result = pageOf(all, page);
    return { ...result, items: result.items.map((row) => Task.restore(row)) };
  }
  async subtasksOf(organizationId: string, projectId: string, parentTaskId: string) {
    return this.in(organizationId, projectId)
      .filter((row) => row.parentTaskId === parentTaskId)
      .sort((a, b) => a.number - b.number)
      .map((row) => Task.restore(row));
  }
  async findByIds(organizationId: string, projectId: string, taskIds: ReadonlyArray<string>) {
    return this.in(organizationId, projectId)
      .filter((row) => taskIds.includes(row.id))
      .sort((a, b) => a.number - b.number)
      .map((row) => Task.restore(row));
  }
  async requiredSubtaskIds(
    organizationId: string,
    projectId: string,
    parentTaskIds: ReadonlyArray<string>,
  ) {
    return this.in(organizationId, projectId)
      .filter(
        (row) =>
          row.isRequired && row.parentTaskId !== null && parentTaskIds.includes(row.parentTaskId),
      )
      .map((row) => row.id);
  }
  async countInOrganization(organizationId: string) {
    return this.in(organizationId).length;
  }
  async revokeAssignments(
    organizationId: string,
    userId: string,
    scope: RevocationScope,
    now: Date,
  ) {
    requireTransaction(this.transactions, 'TaskRepository.revokeAssignments');
    let count = 0;
    this.rows = this.rows.map((row) => {
      const inScope =
        row.organizationId === organizationId &&
        row.assigneeUserId === userId &&
        (scope.kind === 'project'
          ? row.projectId === scope.projectId
          : !scope.exceptProjectIds.includes(row.projectId));
      if (!inScope) return row;
      count += 1;
      return { ...row, assigneeUserId: null, updatedAt: now, version: row.version + 1 };
    });
    return count;
  }
}

export class InMemoryTaskDependencyRepository
  implements TaskDependencyRepository, TransactionalStore
{
  edges: Array<{ organizationId: string; projectId: string; blocked: string; blocking: string }> =
    [];

  constructor(private readonly tasks: InMemoryTaskRepository) {}

  snapshot() {
    return [...this.edges];
  }
  restore(state: unknown) {
    this.edges = state as typeof this.edges;
  }

  private live() {
    // Cascata: dependências de tarefas apagadas somem.
    const ids = new Set(this.tasks.rows.map((row) => row.id));
    this.edges = this.edges.filter((edge) => ids.has(edge.blocked) && ids.has(edge.blocking));
    return this.edges;
  }
  async add(organizationId: string, projectId: string, blocked: string, blocking: string) {
    if (
      this.live().some(
        (edge) =>
          edge.projectId === projectId && edge.blocked === blocked && edge.blocking === blocking,
      )
    ) {
      return false;
    }
    this.edges.push({ organizationId, projectId, blocked, blocking });
    return true;
  }
  async remove(organizationId: string, projectId: string, blocked: string, blocking: string) {
    const before = this.live().length;
    this.edges = this.edges.filter(
      (edge) =>
        !(
          edge.organizationId === organizationId &&
          edge.projectId === projectId &&
          edge.blocked === blocked &&
          edge.blocking === blocking
        ),
    );
    return this.edges.length < before;
  }
  async blockersOf(organizationId: string, projectId: string, taskIds: ReadonlyArray<string>) {
    return this.live()
      .filter(
        (edge) =>
          edge.organizationId === organizationId &&
          edge.projectId === projectId &&
          taskIds.includes(edge.blocked),
      )
      .map((edge) => edge.blocking);
  }
  async blockedBy(
    organizationId: string,
    projectId: string,
    blockingTaskId: string,
    limit: number,
  ) {
    return this.live()
      .filter(
        (edge) =>
          edge.organizationId === organizationId &&
          edge.projectId === projectId &&
          edge.blocking === blockingTaskId,
      )
      .slice(0, limit)
      .map((edge) => edge.blocked);
  }
  async countBlockers(organizationId: string, projectId: string, blockedTaskId: string) {
    return (await this.blockersOf(organizationId, projectId, [blockedTaskId])).length;
  }
  async countInProject(organizationId: string, projectId: string) {
    return this.live().filter(
      (edge) => edge.organizationId === organizationId && edge.projectId === projectId,
    ).length;
  }
}

/** Workflow padrão de `projects` com ids legíveis (`<prefixo>-todo`, `-doing`, `-done`). */
export function workflowOf(prefix: string): WorkflowView {
  const [todo, doing, done] = [`${prefix}-todo`, `${prefix}-doing`, `${prefix}-done`];
  return {
    statuses: [
      { id: todo, name: 'A fazer', category: 'todo', position: 0 },
      { id: doing, name: 'Em andamento', category: 'in_progress', position: 1 },
      { id: done, name: 'Concluído', category: 'done', position: 2 },
    ],
    transitions: [
      { fromStatusId: todo, toStatusId: doing },
      { fromStatusId: doing, toStatusId: todo },
      { fromStatusId: doing, toStatusId: done },
      { fromStatusId: done, toStatusId: doing },
    ],
  };
}

type FakeProject = {
  organizationId: string;
  projectId: string;
  key: string;
  archived: boolean;
  workflow: WorkflowView;
  participations: Map<string, ProjectRole>;
};

/** `projects` e `organizations` vistos pela porta: papéis na organização e participações. */
export class FakeProjectAccess implements ProjectAccess {
  readonly projects: FakeProject[] = [];
  readonly organizationRoles = new Map<string, OrganizationRole>();
  /** Chamadas de `lockForContribution`: projeto e pessoas travados. */
  readonly locks: Array<{ projectId: string; userIds: ReadonlyArray<string> }> = [];

  constructor(private readonly transactions: FakeTransactionRunner) {}

  setMember(organizationId: string, userId: string, role: OrganizationRole | null) {
    if (role === null) this.organizationRoles.delete(`${organizationId}|${userId}`);
    else this.organizationRoles.set(`${organizationId}|${userId}`, role);
  }
  addProject(input: {
    organizationId: string;
    projectId: string;
    key: string;
    workflow?: WorkflowView;
  }) {
    const project: FakeProject = {
      ...input,
      archived: false,
      workflow: input.workflow ?? workflowOf(input.key.toLowerCase()),
      participations: new Map(),
    };
    this.projects.push(project);
    return project;
  }
  projectById(projectId: string): FakeProject {
    const found = this.projects.find((project) => project.projectId === projectId);
    if (!found) throw new Error(`unknown project ${projectId}`);
    return found;
  }

  private find(organizationId: string, lookup: ProjectLookup) {
    return this.projects.find(
      (project) =>
        project.organizationId === organizationId &&
        ('projectId' in lookup
          ? project.projectId === lookup.projectId
          : project.key === lookup.key),
    );
  }
  private roleOf(project: FakeProject, userId: string): ProjectRole | null {
    const organizationRole = this.organizationRoles.get(`${project.organizationId}|${userId}`);
    return organizationRole
      ? effectiveProjectRole(organizationRole, project.participations.get(userId) ?? null)
      : null;
  }

  async lockForContribution(
    organizationId: string,
    lookup: ProjectLookup,
    userIds: ReadonlyArray<string>,
  ): Promise<LockedProject | null> {
    requireTransaction(this.transactions, 'ProjectAccess.lockForContribution');
    const project = this.find(organizationId, lookup);
    if (!project) return null;
    this.locks.push({ projectId: project.projectId, userIds });
    return {
      projectId: project.projectId,
      key: project.key,
      archived: project.archived,
      workflow: project.workflow,
      effectiveRoles: new Map(userIds.map((userId) => [userId, this.roleOf(project, userId)])),
      organizationMembers: new Set(
        userIds.filter((userId) => this.organizationRoles.has(`${organizationId}|${userId}`)),
      ),
    };
  }
  async resolveForRead(
    organizationId: string,
    lookup: ProjectLookup,
    viewer: Readonly<{ userId: string; organizationRole: OrganizationRole }>,
  ): Promise<ReadableProject | null> {
    const project = this.find(organizationId, lookup);
    // Como em `projects`: o papel vem do contexto da requisição, sem lock.
    const effectiveRole = project
      ? effectiveProjectRole(
          viewer.organizationRole,
          project.participations.get(viewer.userId) ?? null,
        )
      : null;
    if (!project || !effectiveRole) return null;
    return {
      projectId: project.projectId,
      key: project.key,
      archived: project.archived,
      workflow: project.workflow,
      effectiveRole,
    };
  }
  async assignableUsers(organizationId: string, projectId: string, page: PageRequest) {
    const project = this.find(organizationId, { projectId });
    const users: AssignableUser[] = [];
    for (const key of this.organizationRoles.keys()) {
      const [organization, userId] = key.split('|');
      if (!project || organization !== organizationId || !userId) continue;
      const effectiveRole = this.roleOf(project, userId);
      if (effectiveRole === 'manager' || effectiveRole === 'member') {
        users.push({ userId, name: userId.toUpperCase(), email: null, effectiveRole });
      }
    }
    return pageOf(users, page);
  }
}

export class InMemoryTaskUserDirectory implements TaskUserDirectory {
  readonly calls: Array<ReadonlyArray<string>> = [];
  async getNames(userIds: ReadonlyArray<string>) {
    this.calls.push(userIds);
    return new Map(userIds.map((userId) => [userId, userId.toUpperCase()]));
  }
}

export class RecordingTasksEvents implements TasksEventRecorder {
  events: TasksEvent[] = [];
  record(event: TasksEvent) {
    this.events.push(event);
  }
}

/** Grafo de fakes para os testes de casos de uso de `tasks`. */
export function createTasksTestbed() {
  const transactions = new FakeTransactionRunner();
  const tasks = new InMemoryTaskRepository(transactions);
  const dependencies = new InMemoryTaskDependencyRepository(tasks);
  transactions.register(tasks, dependencies);
  return {
    transactions,
    tasks,
    dependencies,
    projectAccess: new FakeProjectAccess(transactions),
    users: new InMemoryTaskUserDirectory(),
    events: new RecordingTasksEvents(),
    rateLimiter: new InMemoryRateLimiter(),
    clock: new FixedClock(),
    idGenerator: new SequentialIds(),
  };
}

export type TasksTestbed = ReturnType<typeof createTasksTestbed>;
