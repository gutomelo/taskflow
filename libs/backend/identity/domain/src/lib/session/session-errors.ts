import { DomainError } from '@taskflow/backend/shared/kernel';

export class SessionRevokedError extends DomainError {
  readonly code = 'SESSION_REVOKED';
  constructor() {
    super('Session has been revoked');
  }
}

export class SessionExpiredError extends DomainError {
  readonly code = 'SESSION_EXPIRED';
  constructor() {
    super('Session has expired');
  }
}

/** BR-012: corrida legítima entre abas; o cliente repete a requisição original. */
export class RefreshInProgressError extends DomainError {
  readonly code = 'REFRESH_IN_PROGRESS';
  constructor() {
    super('Refresh token was just rotated by a concurrent request');
  }
}
