import { DomainError } from '@taskflow/backend/shared/kernel';

// Códigos reutilizados de `organizations` e `projects` de propósito: mesmo status e título nos
// contextos — o teste de mapeamentos em `apps/api` falha se divergirem.

/** Ator removido da organização entre o middleware e o lock: mesma resposta 404 do tenant. */
export class OrganizationNotFoundError extends DomainError {
  readonly code = 'ORGANIZATION_NOT_FOUND';
  constructor() {
    super('Organization not found');
  }
}

/** O papel efetivo não permite a ação (403), só quando o projeto é visível ao ator. */
export class InsufficientRoleError extends DomainError {
  readonly code = 'INSUFFICIENT_ROLE';
  constructor() {
    super('Role does not allow this action');
  }
}

/** `projectId` da query ou do corpo inexistente, de outra organização ou sem acesso (404). */
export class ProjectNotFoundError extends DomainError {
  readonly code = 'PROJECT_NOT_FOUND';
  constructor() {
    super('Project not found');
  }
}

/** BR-026 estendida (RF-12): tarefas de projeto arquivado são só leitura (409). */
export class ProjectArchivedError extends DomainError {
  readonly code = 'PROJECT_ARCHIVED';
  constructor() {
    super('The project is archived');
  }
}

/** BR-003: o responsável precisa ter papel efetivo manager/member no projeto (422). */
export class AssigneeNotProjectMemberError extends DomainError {
  readonly code = 'ASSIGNEE_NOT_PROJECT_MEMBER';
  constructor() {
    super('The assignee cannot contribute to the project');
  }
}

/** Status que não é do workflow do projeto (404). */
export class StatusNotFoundError extends DomainError {
  readonly code = 'STATUS_NOT_FOUND';
  constructor() {
    super('Status not found');
  }
}

/** RNF-05: teto de tarefas por projeto ou por organização (422). */
export class TaskLimitReachedError extends DomainError {
  readonly code = 'TASK_LIMIT_REACHED';
  constructor() {
    super('Task limit reached');
  }
}

/** RNF-05: teto de subtarefas por tarefa (422). */
export class SubtaskLimitReachedError extends DomainError {
  readonly code = 'SUBTASK_LIMIT_REACHED';
  constructor() {
    super('Subtask limit reached for the task');
  }
}

/** A dependência a remover não existe (404). */
export class DependencyNotFoundError extends DomainError {
  readonly code = 'DEPENDENCY_NOT_FOUND';
  constructor() {
    super('Dependency not found');
  }
}

/** Cursor de coluna malformado, adulterado ou de outra coluna (400; nunca chega ao banco). */
export class InvalidCursorError extends DomainError {
  readonly code = 'INVALID_CURSOR';
  constructor() {
    super('Invalid cursor');
  }
}
