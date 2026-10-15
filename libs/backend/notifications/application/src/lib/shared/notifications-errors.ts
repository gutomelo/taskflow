import { DomainError } from '@taskflow/backend/shared/kernel';

/** Cursor malformado (400; mesmo código e título dos outros contextos). */
export class InvalidCursorError extends DomainError {
  readonly code = 'INVALID_CURSOR';
  constructor() {
    super('Invalid cursor');
  }
}
