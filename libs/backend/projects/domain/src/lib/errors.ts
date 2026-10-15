import { DomainError } from '@taskflow/backend/shared/kernel';

/** BR-025: formato `[A-Z][A-Z0-9]{1,9}`, sem normalização silenciosa. */
export class InvalidProjectKeyError extends DomainError {
  readonly code = 'INVALID_PROJECT_KEY';
  constructor() {
    super('Invalid project key');
  }
}

export class InvalidProjectNameError extends DomainError {
  readonly code = 'INVALID_PROJECT_NAME';
  constructor() {
    super('Invalid project name');
  }
}

export class InvalidProjectDescriptionError extends DomainError {
  readonly code = 'INVALID_PROJECT_DESCRIPTION';
  constructor() {
    super('Invalid project description');
  }
}

/** BR-025: chave já usada na organização, inclusive por projeto arquivado (índice único). */
export class ProjectKeyTakenError extends DomainError {
  readonly code = 'PROJECT_KEY_TAKEN';
  constructor() {
    super('Project key already taken in this organization');
  }
}

/** BR-026: projeto arquivado é somente leitura. */
export class ProjectArchivedError extends DomainError {
  readonly code = 'PROJECT_ARCHIVED';
  constructor() {
    super('The project is archived');
  }
}

/** BR-027: o papel no projeto passaria do teto dado pelo papel na organização. */
export class ProjectRoleAboveCeilingError extends DomainError {
  readonly code = 'PROJECT_ROLE_ABOVE_CEILING';
  constructor() {
    super('Project role above the ceiling of the organization role');
  }
}

/** BR-027: o usuário já participa do projeto (inclusive por corrida, pelo índice único). */
export class AlreadyAProjectMemberError extends DomainError {
  readonly code = 'ALREADY_A_PROJECT_MEMBER';
  constructor() {
    super('User already participates in the project');
  }
}

/**
 * BR-027 / D1: owner e admin da organização já gerenciam todos os projetos; uma participação
 * gravada só passaria a valer depois de um rebaixamento (privilégio adormecido).
 */
export class AlreadyManagesAllProjectsError extends DomainError {
  readonly code = 'ALREADY_MANAGES_ALL_PROJECTS';
  constructor() {
    super('Organization owners and admins already manage every project');
  }
}

/**
 * BR-027: o usuário não é membro da organização (inexistente, de outra organização ou removido —
 * sem distinção). Mesmo `code` de `organizations` de propósito (design, S-7): mesmo status e
 * título nos dois contextos.
 */
export class NotAnOrganizationMemberError extends DomainError {
  readonly code = 'MEMBER_NOT_FOUND';
  constructor() {
    super('User is not a member of the organization');
  }
}

// --- Workflow configurável (spec 005, BR-030) ---

/** Nome de status: texto exibível de 1 a 40 caracteres. */
export class InvalidStatusNameError extends DomainError {
  readonly code = 'INVALID_STATUS_NAME';
  constructor() {
    super('Invalid status name');
  }
}

/** Nome repetido no workflow, sem diferenciar maiúsculas (também por índice único). */
export class StatusNameTakenError extends DomainError {
  readonly code = 'STATUS_NAME_TAKEN';
  constructor() {
    super('Status name already used in this workflow');
  }
}

/** Status fora do workflow do projeto (inexistente, de outro projeto ou organização): 404. */
export class StatusNotFoundError extends DomainError {
  readonly code = 'STATUS_NOT_FOUND';
  constructor() {
    super('Status not found');
  }
}

/** A categoria só muda em status sem nenhuma tarefa (decisão 3 da spec 005). */
export class StatusInUseError extends DomainError {
  readonly code = 'STATUS_IN_USE';
  constructor() {
    super('The status has tasks');
  }
}

/** Destino da remoção ausente, igual ao removido ou de outra categoria (D2). */
export class InvalidStatusTargetError extends DomainError {
  readonly code = 'INVALID_STATUS_TARGET';
  constructor() {
    super('Invalid target status');
  }
}

/** O workflow precisa de ao menos um status `todo` (status inicial das tarefas novas). */
export class WorkflowNeedsTodoStatusError extends DomainError {
  readonly code = 'WORKFLOW_NEEDS_TODO_STATUS';
  constructor() {
    super('The workflow needs a status of category todo');
  }
}

export class StatusLimitReachedError extends DomainError {
  readonly code = 'STATUS_LIMIT_REACHED';
  constructor() {
    super('Status limit reached for the project');
  }
}

/** A nova ordem precisa listar exatamente os status do workflow, uma vez cada. */
export class InvalidStatusOrderError extends DomainError {
  readonly code = 'INVALID_STATUS_ORDER';
  constructor() {
    super('Invalid status order');
  }
}

/** Transição de um status para ele mesmo ou repetida. */
export class InvalidTransitionError extends DomainError {
  readonly code = 'INVALID_TRANSITION';
  constructor() {
    super('Invalid transition');
  }
}
