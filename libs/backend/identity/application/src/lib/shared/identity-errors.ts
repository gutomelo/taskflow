import { DomainError } from '@taskflow/backend/shared/kernel';

/** Mesma resposta para e-mail inexistente e senha errada (BR-014): nunca revela qual falhou. */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';
  constructor() {
    super('Invalid email or password');
  }
}

/** Sessão inexistente ou de outro usuário: 404 sem distinguir os casos (não revela existência). */
export class SessionNotFoundError extends DomainError {
  readonly code = 'SESSION_NOT_FOUND';
  constructor() {
    super('Session not found');
  }
}

/**
 * BR-017: link de verificação usado por outra conta autenticada. O token **não** é consumido,
 * para que o titular verdadeiro ainda possa usá-lo na própria conta.
 */
export class TokenBelongsToAnotherAccountError extends DomainError {
  readonly code = 'TOKEN_BELONGS_TO_ANOTHER_ACCOUNT';
  constructor() {
    super('Verification token belongs to another account');
  }
}

/** Troca de senha autenticada com a senha atual errada (RF-09). */
export class CurrentPasswordIncorrectError extends DomainError {
  readonly code = 'CURRENT_PASSWORD_INCORRECT';
  constructor() {
    super('Current password is incorrect');
  }
}
