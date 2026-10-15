import type { GetUserAccountsUseCase } from '@taskflow/backend/identity/application';
import type { UserDirectory } from '@taskflow/backend/projects/application';

/** Porta `UserDirectory` de `projects` ligada à consulta pública de `identity` (só nome e e-mail). */
export function createProjectUserDirectory(identity: {
  readonly userAccounts: Pick<GetUserAccountsUseCase, 'execute'>;
}): UserDirectory {
  return {
    async getAccounts(userIds) {
      const accounts = await identity.userAccounts.execute(userIds);
      return new Map(accounts.map(({ id, name, email }) => [id, { id, name, email }] as const));
    },
  };
}
