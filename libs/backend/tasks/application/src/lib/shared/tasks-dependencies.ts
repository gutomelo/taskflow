import type {
  OutboxWriter,
  RateLimiter,
  TransactionRunner,
} from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import type { TaskDependencyRepository, TaskRepository } from '@taskflow/backend/tasks/domain';
import type { ProjectAccess } from '../ports/project-access';
import type { TaskUserDirectory } from '../ports/user-directory';
import type { TasksEventRecorder } from './tasks-events';

/** Dependências dos casos de uso de `tasks`, montadas uma vez no composition root. */
export interface TasksDependencies {
  readonly projectAccess: ProjectAccess;
  readonly tasks: TaskRepository;
  readonly dependencies: TaskDependencyRepository;
  readonly users: TaskUserDirectory;
  readonly transactions: TransactionRunner;
  readonly rateLimiter: RateLimiter;
  readonly events: TasksEventRecorder;
  /** Eventos de integração (ADR 0017), na transação da casca. */
  readonly outbox: OutboxWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}
