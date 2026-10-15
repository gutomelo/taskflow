import type { EmailSender } from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';
import { ListActiveMentionsUseCase } from '@taskflow/backend/collaboration/application';
import { PrismaCommentRepository } from '@taskflow/backend/collaboration/infrastructure';
import {
  GetUserAccountsUseCase,
  MAX_ACCOUNTS_PER_QUERY,
} from '@taskflow/backend/identity/application';
import { PrismaUserRepository } from '@taskflow/backend/identity/infrastructure';
import {
  PlanDigestsUseCase,
  PurgeOldNotificationsUseCase,
  RecordNotificationsUseCase,
  SendDigestUseCase,
  type NotificationPeople,
  type NotificationTargets,
} from '@taskflow/backend/notifications/application';
import {
  PrismaNotificationPreferenceRepository,
  PrismaNotificationRepository,
  PtBrDigestMailer,
} from '@taskflow/backend/notifications/infrastructure';
import {
  GetMemberRolesUseCase,
  ListUserMembershipsUseCase,
} from '@taskflow/backend/organizations/application';
import {
  PrismaMembershipRepository,
  PrismaOrganizationRepository,
} from '@taskflow/backend/organizations/infrastructure';
import { ResolveReadableProjectsUseCase } from '@taskflow/backend/projects/application';
import { PrismaProjectRepository } from '@taskflow/backend/projects/infrastructure';
import { ResolveVisibleTasksUseCase } from '@taskflow/backend/tasks/application';
import { PrismaTaskRepository } from '@taskflow/backend/tasks/infrastructure';

export interface NotificationsModuleDependencies {
  readonly transactions: PrismaTransactionRunner;
  readonly emailSender: EmailSender;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly appUrl: string;
}

/**
 * Porta `NotificationTargets` (spec 008, D9) com as consultas públicas de `tasks` (que consulta
 * `projects`) e `collaboration`. Só leitura; erro propaga (falha fechado). Mesmo comportamento do
 * adaptador da API (apps não importam umas das outras).
 */
function createNotificationTargets(transactions: PrismaTransactionRunner): NotificationTargets {
  const readableProjects = new ResolveReadableProjectsUseCase({
    projects: new PrismaProjectRepository(transactions),
  });
  const visibleTasks = new ResolveVisibleTasksUseCase({
    tasks: new PrismaTaskRepository(transactions),
    projectAccess: {
      readableProjects: (organizationId, projectIds, viewer) =>
        readableProjects.execute(organizationId, projectIds, viewer),
    },
  });
  const activeMentions = new ListActiveMentionsUseCase({
    comments: new PrismaCommentRepository(transactions),
  });
  return {
    visibleTasks: (organizationId, viewer, taskIds) =>
      visibleTasks.execute(organizationId, viewer, taskIds),
    activeMentions: (organizationId, mentions) => activeMentions.execute(organizationId, mentions),
  };
}

/** Porta `NotificationPeople`: membros atuais (`organizations`) e conta verificada (`identity`). */
function createNotificationPeople(transactions: PrismaTransactionRunner): NotificationPeople {
  const memberships = new PrismaMembershipRepository(transactions);
  const rolesOf = new GetMemberRolesUseCase({ memberships });
  const userMemberships = new ListUserMembershipsUseCase({
    organizations: new PrismaOrganizationRepository(transactions),
    memberships,
  });
  const userAccounts = new GetUserAccountsUseCase({
    users: new PrismaUserRepository(transactions),
  });
  return {
    async displayNames(organizationId, userIds) {
      const unique = [...new Set(userIds)];
      if (unique.length === 0) return new Map();
      const roles = await rolesOf.execute(organizationId, unique);
      const members = unique.filter((userId) => roles.has(userId));
      const names = new Map<string, string>();
      for (let start = 0; start < members.length; start += MAX_ACCOUNTS_PER_QUERY) {
        const accounts = await userAccounts.execute(
          members.slice(start, start + MAX_ACCOUNTS_PER_QUERY),
        );
        for (const { id, name } of accounts) names.set(id, name);
      }
      return names;
    },
    async memberships(userId, organizationIds) {
      const wanted = new Set(organizationIds);
      const found = await userMemberships.execute(userId);
      return new Map(
        found
          .filter((membership) => wanted.has(membership.organizationId))
          .map(({ organizationId, slug, role }) => [organizationId, { slug, role }] as const),
      );
    },
    async digestAddress(userId) {
      const [account] = await userAccounts.execute([userId]);
      return account?.emailVerified ? { email: account.email, name: account.name } : null;
    },
  };
}

/**
 * Composição do contexto Notifications no worker (spec 008, T8): registro dos eventos de
 * integração, resumo por e-mail e retenção. Os outros contextos entram só por consultas.
 */
export function createNotificationsModule(deps: NotificationsModuleDependencies) {
  const notifications = new PrismaNotificationRepository(deps.transactions);
  const shared = {
    notifications,
    preferences: new PrismaNotificationPreferenceRepository(deps.transactions),
    targets: createNotificationTargets(deps.transactions),
    people: createNotificationPeople(deps.transactions),
    clock: deps.clock,
  };
  return {
    recordNotifications: new RecordNotificationsUseCase({
      notifications,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    planDigests: new PlanDigestsUseCase({ notifications }),
    sendDigest: new SendDigestUseCase({
      ...shared,
      mailer: new PtBrDigestMailer(deps.emailSender),
      appUrl: deps.appUrl,
    }),
    purgeOldNotifications: new PurgeOldNotificationsUseCase({ notifications }),
  };
}

export type NotificationsModule = ReturnType<typeof createNotificationsModule>;
