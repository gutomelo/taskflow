import type { GetUserAccountsUseCase } from '@taskflow/backend/identity/application';
import type { TaskUserDirectory } from '@taskflow/backend/tasks/application';

/** Porta `TaskUserDirectory` de `tasks` ligada à consulta pública de `identity` (só o nome). */
export function createTaskUserDirectory(identity: {
  readonly userAccounts: Pick<GetUserAccountsUseCase, 'execute'>;
}): TaskUserDirectory {
  return {
    async getNames(userIds) {
      if (userIds.length === 0) return new Map();
      const accounts = await identity.userAccounts.execute(userIds);
      return new Map(accounts.map(({ id, name }) => [id, name] as const));
    },
  };
}
