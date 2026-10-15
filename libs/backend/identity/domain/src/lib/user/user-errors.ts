import { DomainError } from '@taskflow/backend/shared/kernel';

/**
 * Já existe conta com o e-mail (violação de unicidade, inclusive em cadastros concorrentes).
 * Nunca exposto ao cliente: o cadastro responde igual nos dois casos (BR-014).
 */
export class EmailAlreadyRegisteredError extends DomainError {
  readonly code = 'EMAIL_ALREADY_REGISTERED';

  constructor() {
    super('Email address is already registered');
  }
}
