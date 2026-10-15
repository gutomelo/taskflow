import type { RequestHandler } from 'express';
import {
  CountUnreadUseCase,
  GetNotificationPreferenceUseCase,
  ListNotificationsUseCase,
  MarkAllReadUseCase,
  MarkReadUseCase,
  UpdateNotificationPreferenceUseCase,
  type NotificationPeople,
  type NotificationsDependencies,
  type NotificationTargets,
} from '@taskflow/backend/notifications/application';
import {
  createNotificationsRouters,
  notificationsErrorMappings,
} from '@taskflow/backend/notifications/http';
import {
  PrismaNotificationPreferenceRepository,
  PrismaNotificationRepository,
} from '@taskflow/backend/notifications/infrastructure';
import type { RateLimiter } from '@taskflow/backend/shared/application';
import type { CsrfProtection } from '@taskflow/backend/shared/http';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';

export interface NotificationsModuleDependencies {
  readonly transactions: PrismaTransactionRunner;
  readonly rateLimiter: RateLimiter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Adaptadores de leitura (`tasks`, `collaboration`, `organizations`, `identity`). */
  readonly targets: NotificationTargets;
  readonly people: NotificationPeople;
  readonly authenticate: RequestHandler;
  readonly csrf: CsrfProtection;
}

/**
 * Composition root do contexto Notifications na API (spec 008): leitura e marcação. O registro e
 * o resumo rodam no worker. Montado por último: nenhum módulo depende dele.
 */
export function createNotificationsModule(deps: NotificationsModuleDependencies) {
  const shared: NotificationsDependencies = {
    notifications: new PrismaNotificationRepository(deps.transactions),
    preferences: new PrismaNotificationPreferenceRepository(deps.transactions),
    targets: deps.targets,
    people: deps.people,
    rateLimiter: deps.rateLimiter,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };
  const useCases = {
    listNotifications: new ListNotificationsUseCase(shared),
    countUnread: new CountUnreadUseCase(shared),
    markRead: new MarkReadUseCase(shared),
    markAllRead: new MarkAllReadUseCase(shared),
    getPreference: new GetNotificationPreferenceUseCase(shared),
    updatePreference: new UpdateNotificationPreferenceUseCase(shared),
  };
  const routers = createNotificationsRouters({
    useCases,
    authenticate: deps.authenticate,
    csrf: deps.csrf,
  });
  return {
    useCases,
    globalRouter: routers.globalRouter,
    tenantRouter: routers.tenantRouter,
    domainErrors: notificationsErrorMappings,
  };
}

export type NotificationsModule = ReturnType<typeof createNotificationsModule>;
