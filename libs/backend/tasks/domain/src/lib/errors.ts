import { DomainError } from '@taskflow/backend/shared/kernel';

export class InvalidTaskTitleError extends DomainError {
  readonly code = 'INVALID_TASK_TITLE';
  constructor() {
    super('Invalid task title');
  }
}

export class InvalidTaskDescriptionError extends DomainError {
  readonly code = 'INVALID_TASK_DESCRIPTION';
  constructor() {
    super('Invalid task description');
  }
}

export class InvalidDueDateError extends DomainError {
  readonly code = 'INVALID_DUE_DATE';
  constructor() {
    super('Invalid due date');
  }
}

/** BR-029: tarefa cancelada é só leitura até ser reaberta. */
export class TaskCanceledError extends DomainError {
  readonly code = 'TASK_CANCELED';
  constructor() {
    super('The task is canceled');
  }
}

/** BR-004: a transição não está no workflow do projeto. */
export class TransitionNotAllowedError extends DomainError {
  readonly code = 'TRANSITION_NOT_ALLOWED';
  constructor() {
    super('Status transition not allowed by the project workflow');
  }
}

/** BR-001: subtarefas obrigatórias pendentes (ids devolvidos ao cliente). */
export class TaskHasPendingRequiredSubtasksError extends DomainError {
  readonly code = 'TASK_HAS_PENDING_REQUIRED_SUBTASKS';
  constructor(readonly taskIds: ReadonlyArray<string>) {
    super('The task has pending required subtasks');
  }
}

/** BR-006: bloqueadoras pendentes (ids devolvidos ao cliente). */
export class TaskBlockedByDependenciesError extends DomainError {
  readonly code = 'TASK_BLOCKED_BY_DEPENDENCIES';
  constructor(readonly taskIds: ReadonlyArray<string>) {
    super('The task is blocked by pending dependencies');
  }
}

/** BR-001 (D1): a operação deixaria um pai concluído com subtarefa obrigatória pendente. */
export class ParentTaskCompletedError extends DomainError {
  readonly code = 'PARENT_TASK_COMPLETED';
  constructor() {
    super('The parent task is completed');
  }
}

/** Subtarefas têm um nível só. */
export class SubtaskDepthError extends DomainError {
  readonly code = 'SUBTASK_DEPTH';
  constructor() {
    super('A subtask cannot have subtasks');
  }
}

/** "Obrigatória" só existe em subtarefa. */
export class RequiredWithoutParentError extends DomainError {
  readonly code = 'REQUIRED_WITHOUT_PARENT';
  constructor() {
    super('Only subtasks can be required');
  }
}

/** BR-006 (com D4): a dependência fecharia um ciclo, explícito ou implícito. */
export class DependencyCycleError extends DomainError {
  readonly code = 'DEPENDENCY_CYCLE';
  constructor() {
    super('The dependency would create a cycle');
  }
}

/** Teto de busca no grafo ou de dependências excedido. */
export class DependencyLimitReachedError extends DomainError {
  readonly code = 'DEPENDENCY_LIMIT_REACHED';
  constructor() {
    super('Dependency limit reached');
  }
}

/** Tarefa inexistente, de outro projeto ou sem acesso — inclusive apagada no meio (P2003): 404. */
export class TaskNotFoundError extends DomainError {
  readonly code = 'TASK_NOT_FOUND';
  constructor() {
    super('Task not found');
  }
}

/** BR-009: vizinho fora da coluna de destino (inexistente, outro projeto, subtarefa, cancelado). */
export class InvalidPositionError extends DomainError {
  readonly code = 'INVALID_POSITION';
  constructor() {
    super('Invalid position on the board');
  }
}

/** Só tarefas de primeiro nível são cards do quadro (spec 005). */
export class TaskNotACardError extends DomainError {
  readonly code = 'TASK_NOT_A_CARD';
  constructor() {
    super('Subtasks are not board cards');
  }
}
