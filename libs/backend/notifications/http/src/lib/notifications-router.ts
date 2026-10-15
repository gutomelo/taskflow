import { Router, type Request, type RequestHandler } from 'express';
import {
  HttpError,
  noStore,
  parseBody,
  requestContextFrom,
  tenantRequestContextFrom,
  type CsrfProtection,
} from '@taskflow/backend/shared/http';
import type {
  CountUnreadUseCase,
  GetNotificationPreferenceUseCase,
  ListNotificationsUseCase,
  MarkAllReadUseCase,
  MarkReadUseCase,
  NotificationView,
  UpdateNotificationPreferenceUseCase,
} from '@taskflow/backend/notifications/application';
import {
  markAllReadRequestSchema,
  notificationIdParamSchema,
  notificationListQuerySchema,
  updateNotificationPreferenceRequestSchema,
  type NotificationDto,
  type NotificationPage,
  type NotificationPreference,
  type UnreadCount,
} from '@taskflow/contracts';
import type { z } from 'zod';

type Executes<T extends { execute: (...args: never[]) => unknown }> = Pick<T, 'execute'>;

export interface NotificationsHttpDependencies {
  readonly useCases: Readonly<{
    listNotifications: Executes<ListNotificationsUseCase>;
    countUnread: Executes<CountUnreadUseCase>;
    markRead: Executes<MarkReadUseCase>;
    markAllRead: Executes<MarkAllReadUseCase>;
    getPreference: Executes<GetNotificationPreferenceUseCase>;
    updatePreference: Executes<UpdateNotificationPreferenceUseCase>;
  }>;
  readonly authenticate: RequestHandler;
  readonly csrf: CsrfProtection;
}

export interface NotificationsRouters {
  /** Rotas da própria conta (`/me`), montadas direto em `/api/v1`. */
  readonly globalRouter: Router;
  /** Rotas tenant-scoped, montadas no `createTenantScope`. */
  readonly tenantRouter: Router;
}

function parseQuery<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): z.output<TSchema> {
  const result = schema.safeParse(request.query);
  if (result.success) return result.data;
  throw new HttpError(400, 'VALIDATION_FAILED', 'Dados inválidos', {
    violations: result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(query)',
      message: issue.message,
    })),
  });
}

const toNotificationDto = (view: NotificationView): NotificationDto => ({
  id: view.id,
  kind: view.kind,
  actor: { userId: view.actor.userId, name: view.actor.name },
  task: { id: view.task.id, key: view.task.key, title: view.task.title },
  commentId: view.commentId,
  occurredAt: view.occurredAt.toISOString(),
  readAt: view.readAt?.toISOString() ?? null,
});

/** Rotas de notificações (spec 008): pessoais; o tenant vem do escopo (ADR 0012). */
export function createNotificationsRouters(
  deps: NotificationsHttpDependencies,
): NotificationsRouters {
  const { useCases, authenticate, csrf } = deps;

  const tenantRouter = Router({ mergeParams: true });
  tenantRouter.use(noStore);

  tenantRouter.get('/notifications', async (request, response) => {
    const page = await useCases.listNotifications.execute(
      tenantRequestContextFrom(request),
      parseQuery(request, notificationListQuerySchema),
    );
    response.json({
      items: page.items.map(toNotificationDto),
      nextCursor: page.nextCursor,
    } satisfies NotificationPage);
  });

  tenantRouter.get('/notifications/unread-count', async (request, response) => {
    const { count, capped } = await useCases.countUnread.execute(tenantRequestContextFrom(request));
    response.json({ count, capped } satisfies UnreadCount);
  });

  tenantRouter.post('/notifications/read-all', async (request, response) => {
    const { upToId } = parseBody(request, markAllReadRequestSchema);
    await useCases.markAllRead.execute(
      tenantRequestContextFrom(request),
      upToId === undefined ? {} : { upToId },
    );
    response.status(204).end();
  });

  tenantRouter.post('/notifications/:notificationId/read', async (request, response) => {
    const parsed = notificationIdParamSchema.safeParse(request.params);
    // Parâmetro malformado responde como inexistente (sem oráculo, sem 500).
    if (!parsed.success) {
      throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', 'Notificação não encontrada');
    }
    await useCases.markRead.execute(tenantRequestContextFrom(request), parsed.data.notificationId);
    response.status(204).end();
  });

  // Sem `router.use`: montado em `/api/v1` junto com os demais e não pode exigir sessão alheia.
  const globalRouter = Router();
  globalRouter.get(
    '/me/notification-preferences',
    noStore,
    authenticate,
    async (request, response) => {
      const preference = await useCases.getPreference.execute(
        requestContextFrom(request).actor.userId,
      );
      response.json({ emailDigest: preference.emailDigest } satisfies NotificationPreference);
    },
  );
  globalRouter.put(
    '/me/notification-preferences',
    noStore,
    authenticate,
    csrf.require(),
    async (request, response) => {
      const saved = await useCases.updatePreference.execute(
        requestContextFrom(request).actor.userId,
        parseBody(request, updateNotificationPreferenceRequestSchema),
      );
      response.json({ emailDigest: saved.emailDigest } satisfies NotificationPreference);
    },
  );

  return { globalRouter, tenantRouter };
}
