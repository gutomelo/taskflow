import { DomainError } from '@taskflow/backend/shared/kernel';

/** Notificação alheia, inexistente ou invisível: o mesmo 404 (são pessoais). */
export class NotificationNotFoundError extends DomainError {
  readonly code = 'NOTIFICATION_NOT_FOUND';
  constructor() {
    super('Notification not found');
  }
}
