import type { CollaborationUserDirectory } from '@taskflow/backend/collaboration/application';
import {
  MAX_ACCOUNTS_PER_QUERY,
  type GetUserAccountsUseCase,
} from '@taskflow/backend/identity/application';
import type { GetMemberRolesUseCase } from '@taskflow/backend/organizations/application';

/**
 * Porta `CollaborationUserDirectory` (spec 010, D12): nomes de `identity` só de quem ainda é membro
 * da organização (`organizations`); quem saiu fica fora do mapa ("Ex-membro").
 */
export function createCollaborationUserDirectory(deps: {
  readonly organizations: Readonly<{
    access: Readonly<{ rolesOf: Pick<GetMemberRolesUseCase, 'execute'> }>;
  }>;
  readonly identity: Readonly<{ userAccounts: Pick<GetUserAccountsUseCase, 'execute'> }>;
}): CollaborationUserDirectory {
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
  };
}
