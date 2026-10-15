import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { z } from 'zod';
import { problemResponse, SECURITY } from '@taskflow/backend/shared/http';
import {
  markAllReadRequestSchema,
  notificationListQuerySchema,
  notificationPageSchema,
  notificationPreferenceSchema,
  notificationSchema,
  unreadCountSchema,
  updateNotificationPreferenceRequestSchema,
} from '@taskflow/contracts';

/** Componentes reutilizáveis do contexto notifications no documento OpenAPI. */
export const notificationsOpenApiSchemas = {
  Notification: notificationSchema,
  NotificationPage: notificationPageSchema,
  UnreadCount: unreadCountSchema,
  NotificationPreference: notificationPreferenceSchema,
};

const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
const tags = ['Notifications'];
const organizationPath = z.object({ organizationId: z.uuid() });
const BASE = '/api/v1/organizations/{organizationId}/notifications';
const unauthenticated = problemResponse('Não autenticado ou sessão encerrada');
const notMember = problemResponse(
  'Organização inexistente ou sem vínculo (ORGANIZATION_NOT_FOUND)',
);
const limited = (name: string) => problemResponse(`Limite excedido: ${name} (Retry-After)`);

export const notificationsOpenApiPaths: ZodOpenApiPathsObject = {
  [BASE]: {
    get: {
      tags,
      summary:
        'Notificações do próprio usuário na organização, mais recentes primeiro (páginas podem vir curtas)',
      security: SECURITY.authenticated,
      requestParams: { path: organizationPath, query: notificationListQuerySchema },
      responses: {
        '200': { description: 'Página', ...json(notificationPageSchema) },
        '400': problemResponse('Consulta ou cursor inválidos (INVALID_CURSOR)'),
        '401': unauthenticated,
        '404': notMember,
        '429': limited('notifications.list.user.minute'),
      },
    },
  },
  [`${BASE}/unread-count`]: {
    get: {
      tags,
      summary: 'Não lidas visíveis do próprio usuário (até 99; `capped` acima disso)',
      security: SECURITY.authenticated,
      requestParams: { path: organizationPath },
      responses: {
        '200': { description: 'Contador', ...json(unreadCountSchema) },
        '401': unauthenticated,
        '404': notMember,
        '429': limited('notifications.count.user.minute'),
      },
    },
  },
  [`${BASE}/read-all`]: {
    post: {
      tags,
      summary: 'Marca como lidas as do próprio usuário até `upToId` (inclusive; ausente = todas)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: organizationPath },
      requestBody: json(markAllReadRequestSchema),
      responses: {
        '204': { description: 'Marcadas' },
        '400': problemResponse('Dados inválidos'),
        '401': unauthenticated,
        '403': problemResponse('Falha de CSRF'),
        '404': problemResponse(
          'ORGANIZATION_NOT_FOUND ou `upToId` que não é do usuário (NOTIFICATION_NOT_FOUND)',
        ),
        '429': limited('notifications.write.user.minute'),
      },
    },
  },
  [`${BASE}/{notificationId}/read`]: {
    post: {
      tags,
      summary: 'Marca uma como lida (alheia, inexistente ou invisível ⇒ o mesmo 404)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: organizationPath.extend({ notificationId: z.uuid() }) },
      responses: {
        '204': { description: 'Lida' },
        '401': unauthenticated,
        '403': problemResponse('Falha de CSRF'),
        '404': problemResponse('NOTIFICATION_NOT_FOUND ou ORGANIZATION_NOT_FOUND'),
        '429': limited('notifications.write.user.minute'),
      },
    },
  },
  '/api/v1/me/notification-preferences': {
    get: {
      tags,
      summary: 'Preferência da própria conta: receber o resumo por e-mail',
      security: SECURITY.authenticated,
      responses: {
        '200': { description: 'Preferência', ...json(notificationPreferenceSchema) },
        '401': unauthenticated,
      },
    },
    put: {
      tags,
      summary: 'Liga ou desliga o resumo por e-mail (última escrita vence)',
      security: SECURITY.authenticatedWithCsrf,
      requestBody: json(updateNotificationPreferenceRequestSchema),
      responses: {
        '200': { description: 'Salva', ...json(notificationPreferenceSchema) },
        '400': problemResponse('Dados inválidos'),
        '401': unauthenticated,
        '403': problemResponse('Falha de CSRF'),
      },
    },
  },
};
