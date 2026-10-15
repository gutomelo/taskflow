import { DomainError } from './domain-error';

/**
 * Optimistic locking (ADR 0006, BR-008): a entidade mudou desde que foi lida.
 * Mapeado para HTTP 409; o cliente recarrega e decide como reaplicar a alteração.
 */
export class VersionConflictError extends DomainError {
  readonly code = 'VERSION_CONFLICT';

  constructor(readonly entity: string) {
    super(`${entity} was modified concurrently`);
  }
}
