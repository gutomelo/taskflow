import { IdentityEventType } from '@taskflow/backend/identity/application';

/** Fila dos e-mails transacionais (ADR 0011); o consumidor entra na T21. */
export const EMAIL_QUEUE_NAME = 'emails';

/** Tipos de evento da outbox publicados na fila `emails`. */
export const EMAIL_EVENT_TYPES: ReadonlyArray<string> = Object.values(IdentityEventType);
