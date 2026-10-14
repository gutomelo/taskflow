import type { Logger } from 'pino';
import type { RateLimiter, TransactionRunner } from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';
import { createTasksRouter, tasksErrorMappings } from '@taskflow/backend/tasks/http';
import {
  AddDependencyUseCase,
  AssignTaskUseCase,
  CancelTaskUseCase,
  CreateTaskUseCase,
  DeleteTaskUseCase,
  GetTaskUseCase,
  ListAssignableUsersUseCase,
  ListTasksUseCase,
  RemoveDependencyUseCase,
  ReopenTaskUseCase,
  RevokeAssignmentsOnAccessLossUseCase,
  TransitionTaskUseCase,
  UpdateTaskUseCase,
  type ProjectAccess,
  type TasksDependencies,
  type TasksEventRecorder,
  type TaskUserDirectory,
} from '@taskflow/backend/tasks/application';
import {
  PrismaTaskDependencyRepository,
  PrismaTaskRepository,
} from '@taskflow/backend/tasks/infrastructure';

export interface TasksFoundationDependencies {
  /** A mesma instância de todos os módulos (as portas rodam na transação do chamador). */
  readonly transactions: PrismaTransactionRunner & TransactionRunner;
  readonly clock: Clock;
}

/**
 * Passo 1 da ordem de montagem (design da spec 004): repositórios de `tasks` e a revogação de
 * atribuições, que dependem só deles. Vem antes de `projects`, que a recebe pela porta
 * `ProjectContributorChanges` — sem ciclo de construção.
 */
export function createTasksFoundation(deps: TasksFoundationDependencies) {
  const tasks = new PrismaTaskRepository(deps.transactions);
  return {
    tasks,
    dependencies: new PrismaTaskDependencyRepository(deps.transactions),
    revokeAssignmentsOnAccessLoss: new RevokeAssignmentsOnAccessLossUseCase({
      tasks,
      clock: deps.clock,
    }),
  };
}

export type TasksFoundation = ReturnType<typeof createTasksFoundation>;

export interface TasksModuleDependencies {
  readonly foundation: TasksFoundation;
  readonly logger: Logger;
  readonly transactions: PrismaTransactionRunner & TransactionRunner;
  readonly rateLimiter: RateLimiter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Adaptador para `projects` (passo 5 da ordem de montagem). */
  readonly projectAccess: ProjectAccess;
  /** Nomes de `identity` (adaptador do composition root). */
  readonly users: TaskUserDirectory;
}

/** Composition root do contexto Tasks (spec 004): casos de uso sobre a fundação. */
export function createTasksModule(deps: TasksModuleDependencies) {
  const { foundation, logger } = deps;
  // Eventos `tasks.*` no log estruturado, só com ids, depois do commit.
  const events: TasksEventRecorder = {
    record: (event) => logger.info({ taskEvent: event }, event.type),
  };
  const shared: TasksDependencies = {
    projectAccess: deps.projectAccess,
    tasks: foundation.tasks,
    dependencies: foundation.dependencies,
    users: deps.users,
    transactions: deps.transactions,
    rateLimiter: deps.rateLimiter,
    events,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };
  const useCases = {
    createTask: new CreateTaskUseCase(shared),
    listTasks: new ListTasksUseCase(shared),
    getTask: new GetTaskUseCase(shared),
    listAssignableUsers: new ListAssignableUsersUseCase(shared),
    updateTask: new UpdateTaskUseCase(shared),
    assignTask: new AssignTaskUseCase(shared),
    transitionTask: new TransitionTaskUseCase(shared),
    cancelTask: new CancelTaskUseCase(shared),
    reopenTask: new ReopenTaskUseCase(shared),
    deleteTask: new DeleteTaskUseCase(shared),
    addDependency: new AddDependencyUseCase(shared),
    removeDependency: new RemoveDependencyUseCase(shared),
  };
  return {
    useCases,
    /** Rotas tenant-scoped, montadas pelo composition root no `createTenantScope`. */
    tenantRouter: createTasksRouter({ useCases }),
    domainErrors: tasksErrorMappings,
  };
}

export type TasksModule = ReturnType<typeof createTasksModule>;
