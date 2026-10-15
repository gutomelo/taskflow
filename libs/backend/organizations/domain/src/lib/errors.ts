import { DomainError } from '@taskflow/backend/shared/kernel';

export class InvalidOrganizationNameError extends DomainError {
  readonly code = 'INVALID_ORGANIZATION_NAME';
  constructor() {
    super('Invalid organization name');
  }
}

export class InvalidSlugError extends DomainError {
  readonly code = 'INVALID_SLUG';
  constructor() {
    super('Invalid organization slug');
  }
}

/** BR-019: a organização ficaria sem owner. */
export class LastOwnerError extends DomainError {
  readonly code = 'LAST_OWNER';
  constructor() {
    super('An organization must keep at least one owner');
  }
}

/** BR-021: o papel do ator não permite a alteração ou remoção pedida. */
export class RoleChangeNotAllowedError extends DomainError {
  readonly code = 'ROLE_CHANGE_NOT_ALLOWED';
  constructor() {
    super('Role change not allowed for the acting member');
  }
}

/** BR-021: convites nunca criam owners. */
export class InvalidInvitationRoleError extends DomainError {
  readonly code = 'INVALID_INVITATION_ROLE';
  constructor() {
    super('Invitations cannot grant the owner role');
  }
}

/** BR-022: slug já em uso (unicidade global no banco). */
export class SlugTakenError extends DomainError {
  readonly code = 'SLUG_TAKEN';
  constructor() {
    super('Organization slug already taken');
  }
}

/** O usuário já é membro da organização (convite ou aceite). */
export class AlreadyAMemberError extends DomainError {
  readonly code = 'ALREADY_A_MEMBER';
  constructor() {
    super('User is already a member of the organization');
  }
}

/**
 * Já existe convite aberto para o e-mail (índice único parcial, inclusive por corrida entre
 * dois convites simultâneos). Interno: o caso de uso o trata como reconvite.
 */
export class OpenInvitationExistsError extends DomainError {
  readonly code = 'INVITATION_ALREADY_OPEN';
  constructor() {
    super('An open invitation already exists for this e-mail');
  }
}
