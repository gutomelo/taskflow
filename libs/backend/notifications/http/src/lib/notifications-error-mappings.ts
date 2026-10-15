import type { DomainErrorMapping } from '@taskflow/backend/shared/http';

/**
 * Tradução dos códigos de `notifications` para HTTP (design da spec 008). `INVALID_CURSOR` repete
 * status e título dos outros contextos (teste de colisão em `apps/api`).
 */
export const notificationsErrorMappings: Readonly<Record<string, DomainErrorMapping>> = {
  NOTIFICATION_NOT_FOUND: { status: 404, title: 'Notificação não encontrada' },
  INVALID_CURSOR: { status: 400, title: 'Cursor inválido' },
};
