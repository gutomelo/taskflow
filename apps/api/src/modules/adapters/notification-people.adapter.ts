import {
  MAX_ACCOUNTS_PER_QUERY,
  type GetUserAccountsUseCase,
} from '@taskflow/backend/identity/application';
import type { NotificationPeople } from '@taskflow/backend/notifications/application';
import type {
  GetMemberRolesUseCase,
  ListUserMembershipsUseCase,
} from '@taskflow/backend/organizations/application';

/**
 * Porta `NotificationPeople` de `notifications` (spec 008): nomes só de membros atuais
 * (`organizations` + `identity`), vínculos da pessoa (slug e papel) e endereço **verificado**.
 */
export function createNotificationPeople(deps: {
  readonly organizations: Readonly<{
    access: Readonly<{
      rolesOf: Pick<GetMemberRolesUseCase, 'execute'>;
      userMemberships: Pick<ListUserMembershipsUseCase, 'execute'>;
    }>;
  }>;
  readonly identity: Readonly<{ userAccounts: Pick<GetUserAccountsUseCase, 'execute'> }>;
}): NotificationPeople {
  return {
    async displayNames(organizationId, userIds) {
      const unique = [...new Set(userIds)];
      if (unique.length === 0) return new Map();
      const roles = await deps.organizations.access.rolesOf.execute(organizationId, unique);
      const members = unique.filter((userId) => roles.has(userId));
      const names = new Map<string, string>();
      for (let start = 0; start < members.length; start += MAX_ACCOUNTS_PER_QUERY) {
        const accounts = await deps.identity.userAccounts.execute(
          members.slice(start, start + MAX_ACCOUNTS_PER_QUERY),
        );
        for (const { id, name } of accounts) names.set(id, name);
      }
      return names;
    },
    async memberships(userId, organizationIds) {
      const wanted = new Set(organizationIds);
      const memberships = await deps.organizations.access.userMemberships.execute(userId);
      return new Map(
        memberships
          .filter((membership) => wanted.has(membership.organizationId))
          .map(({ organizationId, slug, role }) => [organizationId, { slug, role }] as const),
      );
    },
    async digestAddress(userId) {
      const [account] = await deps.identity.userAccounts.execute([userId]);
      return account?.emailVerified ? { email: account.email, name: account.name } : null;
    },
  };
}
