import { DomainError } from '@taskflow/backend/shared/kernel';

/** BR-013: criar organização e aceitar convite exigem e-mail verificado (403). */
export class EmailNotVerifiedError extends DomainError {
  readonly code = 'EMAIL_NOT_VERIFIED';
  constructor() {
    super('E-mail address is not verified');
  }
}

/** RNF-04: teto de organizações como owner ou de memberships por usuário (422). */
export class OrganizationLimitReachedError extends DomainError {
  readonly code = 'ORGANIZATION_LIMIT_REACHED';
  constructor(readonly limit: 'owned_organizations' | 'memberships') {
    super(`Organization limit reached: ${limit}`);
  }
}

/**
 * Organização inexistente ou sem membership do ator: mesma resposta 404 do middleware de tenant
 * (não revela existência).
 */
export class OrganizationNotFoundError extends DomainError {
  readonly code = 'ORGANIZATION_NOT_FOUND';
  constructor() {
    super('Organization not found');
  }
}

/** RBAC (BR-021): o papel do ator na organização não permite a ação (403). */
export class InsufficientRoleError extends DomainError {
  readonly code = 'INSUFFICIENT_ROLE';
  constructor() {
    super('Organization role does not allow this action');
  }
}

/** Alvo sem membership nesta organização (inclusive id de outra organização): 404. */
export class MemberNotFoundError extends DomainError {
  readonly code = 'MEMBER_NOT_FOUND';
  constructor() {
    super('Member not found');
  }
}

/** Convite inexistente, de outra organização ou já encerrado (aceito/revogado): 404. */
export class InvitationNotFoundError extends DomainError {
  readonly code = 'INVITATION_NOT_FOUND';
  constructor() {
    super('Invitation not found');
  }
}

/**
 * BR-020: token inexistente, expirado, revogado, já usado ou de convidante que perdeu o poder de
 * convidar — sem distinção (400).
 */
export class InvalidOrExpiredInvitationError extends DomainError {
  readonly code = 'INVALID_OR_EXPIRED_INVITATION';
  constructor() {
    super('Invitation is invalid or expired');
  }
}

/** BR-020: convite de outro e-mail; o token **não** é consumido (403). */
export class InvitationForAnotherAccountError extends DomainError {
  readonly code = 'INVITATION_FOR_ANOTHER_ACCOUNT';
  constructor() {
    super('Invitation belongs to another account');
  }
}
