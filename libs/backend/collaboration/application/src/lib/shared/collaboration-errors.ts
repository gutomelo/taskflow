import { DomainError } from '@taskflow/backend/shared/kernel';

// Códigos reutilizados de `tasks` e `projects` de propósito: mesmo status e título nos contextos —
// o teste de mapeamentos em `apps/api` falha se divergirem.

/** Tarefa inexistente, de outra organização ou de projeto sem leitura: o mesmo 404. */
export class TaskNotFoundError extends DomainError {
  readonly code = 'TASK_NOT_FOUND';
  constructor() {
    super('Task not found');
  }
}

/** O papel efetivo não permite a ação (403), só quando a tarefa é visível ao ator. */
export class InsufficientRoleError extends DomainError {
  readonly code = 'INSUFFICIENT_ROLE';
  constructor() {
    super('Role does not allow this action');
  }
}

/** BR-026: projeto arquivado — sem comentar nem editar (409). */
export class ProjectArchivedError extends DomainError {
  readonly code = 'PROJECT_ARCHIVED';
  constructor() {
    super('The project is archived');
  }
}

/** BR-029: tarefa cancelada — sem comentar nem editar até reabrir (409). */
export class TaskCanceledError extends DomainError {
  readonly code = 'TASK_CANCELED';
  constructor() {
    super('The task is canceled');
  }
}

/** Cursor malformado, adulterado ou de outra tarefa/busca (400; nunca chega ao banco). */
export class InvalidCursorError extends DomainError {
  readonly code = 'INVALID_CURSOR';
  constructor() {
    super('Invalid cursor');
  }
}

/** Leitores demais no projeto para buscar candidatos (422; não esperado: participantes ≤ 500). */
export class TooManyReadersError extends DomainError {
  readonly code = 'TOO_MANY_READERS';
  constructor() {
    super('Too many readers to search');
  }
}
