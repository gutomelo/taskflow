import { DomainError } from '@taskflow/backend/shared/kernel';

// Códigos reutilizados de `organizations` de propósito (design, S-7): mesmo status e título nos
// dois contextos — um teste em `apps/api` falha se os mapeamentos divergirem.

/** Organização apagada ou ator removido depois do middleware: mesma resposta 404 do tenant. */
export class OrganizationNotFoundError extends DomainError {
  readonly code = 'ORGANIZATION_NOT_FOUND';
  constructor() {
    super('Organization not found');
  }
}

/** O papel não permite a ação (403), só quando o projeto é visível ao ator. */
export class InsufficientRoleError extends DomainError {
  readonly code = 'INSUFFICIENT_ROLE';
  constructor() {
    super('Role does not allow this action');
  }
}

/** Projeto inexistente, de outra organização ou sem acesso (BR-023): 404 sem distinção. */
export class ProjectNotFoundError extends DomainError {
  readonly code = 'PROJECT_NOT_FOUND';
  constructor() {
    super('Project not found');
  }
}

/** Alvo que não participa deste projeto (inclusive participante de outro projeto): 404. */
export class ProjectMemberNotFoundError extends DomainError {
  readonly code = 'PROJECT_MEMBER_NOT_FOUND';
  constructor() {
    super('Project member not found');
  }
}

/** RNF-06: teto de projetos por organização (422). */
export class ProjectLimitReachedError extends DomainError {
  readonly code = 'PROJECT_LIMIT_REACHED';
  constructor() {
    super('Project limit reached for the organization');
  }
}

/** RNF-06: teto de participantes por projeto (422). */
export class ProjectMemberLimitReachedError extends DomainError {
  readonly code = 'PROJECT_MEMBER_LIMIT_REACHED';
  constructor() {
    super('Member limit reached for the project');
  }
}
