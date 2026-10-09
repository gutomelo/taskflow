import { DomainError } from '@taskflow/backend/shared/kernel';

/** Mesma resposta para e-mail inexistente e senha errada (BR-014): nunca revela qual falhou. */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';
  constructor() {
    super('Invalid email or password');
  }
}
