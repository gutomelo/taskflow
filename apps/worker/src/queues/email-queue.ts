import { IdentityEventType } from '@taskflow/backend/identity/application';
import { OrganizationsEventType } from '@taskflow/backend/organizations/application';

/** Fila dos e-mails transacionais (ADR 0011); o consumidor entra na T21. */
export const EMAIL_QUEUE_NAME = 'emails';

/** Tipos de evento da outbox publicados na fila `emails`. */
// Tipos listados um a um: um evento futuro de organizations que não seja e-mail não pode cair
// nesta fila (falharia no schema do job).
export const EMAIL_EVENT_TYPES: ReadonlyArray<string> = [
  ...Object.values(IdentityEventType),
  OrganizationsEventType.invitationRequested,
];
