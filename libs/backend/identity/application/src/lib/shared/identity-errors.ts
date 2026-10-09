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
