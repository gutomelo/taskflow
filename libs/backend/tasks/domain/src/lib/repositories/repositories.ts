import type { Priority } from '../task/task-fields';
import type { Task } from '../task/task';

export type Page<T> = Readonly<{ items: ReadonlyArray<T>; nextCursor: string | null }>;
export type PageRequest = Readonly<{ limit: number; cursor: string | null }>;

export type TaskFilter = Readonly<{
  statusId?: string;
  assigneeUserId?: string;
  /** "Sem responsável". */
  unassigned?: boolean;
  priority?: Priority;
  includeCanceled: boolean;
  /** `null` = só tarefas de primeiro nível. */
  parentTaskId: string | null;
}>;

/** Card do quadro com a sua chave (spec 005): tarefa de primeiro nível não cancelada. */
export type RankedCard = Readonly<{ id: string; rank: string }>;

/** Contagem de subtarefas de um card, sem as canceladas. */
export type SubtaskCount = Readonly<{ done: number; total: number }>;

/** Escopo da revogação de atribuições (BR-003), decidido por `projects`. */
export type RevocationScope = Readonly<
  | { kind: 'project'; projectId: string }
  | { kind: 'organization'; exceptProjectIds: ReadonlyArray<string> }
>;

/**
 * Toda operação recebe `organizationId` (e `projectId` quando a tarefa é conhecida) e o aplica em
 * leitura **e** escrita. Escritas tocam no máximo uma linha de tarefa (design, concorrência).
 */
export interface TaskRepository {
  /** BR-028: próximo número do projeto (`upsert` atômico). Só em transação. */
  nextNumber(organizationId: string, projectId: string): Promise<number>;
  /** Serializa invariantes entre tarefas do projeto (BR-001, BR-006, limites). Só em transação. */
  lockProject(organizationId: string, projectId: string): Promise<void>;
  /** `boardRank`: posição do card na coluna do status (fora do agregado, spec 005). */
  add(task: Task, boardRank: string): Promise<void>;
  /** Última chave entre os cards da coluna (sem `exceptTaskId`); `null` se vazia. */
  lastRankInColumn(
    organizationId: string,
    projectId: string,
    statusId: string,
    exceptTaskId?: string,
  ): Promise<string | null>;
  /** Página de cards da coluna por `(rank, id)`, a partir do card `after` (exclusivo). */
  columnPage(
    organizationId: string,
    projectId: string,
    statusId: string,
    page: Readonly<{ limit: number; after: RankedCard | null }>,
  ): Promise<
    Readonly<{ items: ReadonlyArray<Readonly<{ task: Task; rank: string }>>; hasMore: boolean }>
  >;
  /** Subtarefas (sem canceladas) por pai: concluídas e total. */
  subtaskCounts(
    organizationId: string,
    projectId: string,
    parentTaskIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, SubtaskCount>>;
  /** O card `taskId` se for card da coluna `statusId`; senão `null` (uma consulta). */
  cardInColumn(
    organizationId: string,
    projectId: string,
    statusId: string,
    taskId: string,
  ): Promise<RankedCard | null>;
  /** Vizinho imediato de `card` na coluna, pela ordem `(rank, id)`, ignorando `exceptTaskId`. */
  adjacentCard(
    organizationId: string,
    projectId: string,
    statusId: string,
    card: RankedCard,
    direction: 'next' | 'previous',
    exceptTaskId: string,
  ): Promise<RankedCard | null>;
  /** Grava só a posição (sem `version`, D4 da spec 005). */
  placeCard(organizationId: string, projectId: string, taskId: string, rank: string): Promise<void>;
  /**
   * Reescreve as chaves dos cards da coluna (mesma ordem, chaves curtas). Só em transação, sob o
   * lock do projeto em `tasks`; trava as linhas em ordem de `id`. Devolve quantos mudaram.
   */
  rebalanceColumn(organizationId: string, projectId: string, statusId: string): Promise<number>;
  /** Todas as tarefas por status (canceladas e subtarefas incluídas). */
  countByStatus(organizationId: string, projectId: string): Promise<ReadonlyMap<string, number>>;
  /** Move todas as tarefas de um status para outro (mantém a chave; `version + 1`). */
  reassignStatus(
    organizationId: string,
    projectId: string,
    fromStatusId: string,
    toStatusId: string,
    now: Date,
  ): Promise<number>;
  findById(organizationId: string, taskId: string): Promise<Task | null>;
  findByNumber(organizationId: string, projectId: string, number: number): Promise<Task | null>;
  /** `FOR NO KEY UPDATE` na tarefa. Só em transação. */
  lockById(organizationId: string, projectId: string, taskId: string): Promise<Task | null>;
  /** BR-008: `VersionConflictError` se desatualizada. */
  save(task: Task): Promise<void>;
  /** BR-008: `VersionConflictError` se a versão não bater. Subtarefas e dependências em cascata. */
  remove(organizationId: string, projectId: string, taskId: string, version: number): Promise<void>;
  listPage(
    organizationId: string,
    projectId: string,
    filter: TaskFilter,
    page: PageRequest,
  ): Promise<Page<Task>>;
  subtasksOf(
    organizationId: string,
    projectId: string,
    parentTaskId: string,
  ): Promise<ReadonlyArray<Task>>;
  findByIds(
    organizationId: string,
    projectId: string,
    taskIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<Task>>;
  /** Ids das subtarefas obrigatórias dos pais indicados (aresta implícita D4). */
  requiredSubtaskIds(
    organizationId: string,
    projectId: string,
    parentTaskIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<string>>;
  countInOrganization(organizationId: string): Promise<number>;
  /** BR-003: desatribui `userId` no escopo, incrementando a versão; devolve quantas mudaram. Só em transação. */
  revokeAssignments(
    organizationId: string,
    userId: string,
    scope: RevocationScope,
    now: Date,
  ): Promise<number>;
}

export interface TaskDependencyRepository {
  /** `false` se já existia (idempotente). */
  add(
    organizationId: string,
    projectId: string,
    blockedTaskId: string,
    blockingTaskId: string,
  ): Promise<boolean>;
  /** `false` se não existia. */
  remove(
    organizationId: string,
    projectId: string,
    blockedTaskId: string,
    blockingTaskId: string,
  ): Promise<boolean>;
  /** Quem bloqueia cada tarefa indicada ("bloqueada por"). */
  blockersOf(
    organizationId: string,
    projectId: string,
    taskIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<string>>;
  /** Quem a tarefa bloqueia, até `limit`. */
  blockedBy(
    organizationId: string,
    projectId: string,
    blockingTaskId: string,
    limit: number,
  ): Promise<ReadonlyArray<string>>;
  countBlockers(organizationId: string, projectId: string, blockedTaskId: string): Promise<number>;
  countInProject(organizationId: string, projectId: string): Promise<number>;
}
