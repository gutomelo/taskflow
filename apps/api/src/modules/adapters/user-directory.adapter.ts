import type { EmailAddress } from '@taskflow/backend/shared/kernel';
import type {
  FindUserIdByEmailUseCase,
  GetUserAccountsUseCase,
} from '@taskflow/backend/identity/application';
import type { UserDirectory } from '@taskflow/backend/organizations/application';

/**
 * Porta `UserDirectory` de `organizations` ligada às consultas públicas de `identity` (spec 002).
 * Único ponto em que os dois contextos se encontram; nenhum importa o outro.
 */
export function createUserDirectory(identity: {
  readonly userAccounts: Pick<GetUserAccountsUseCase, 'execute'>;
  readonly userIdByEmail: Pick<FindUserIdByEmailUseCase, 'execute'>;
}): UserDirectory {
  return {
    async getAccounts(userIds) {
      const accounts = await identity.userAccounts.execute(userIds);
      return new Map(accounts.map((account) => [account.id, account]));
    },
    findUserIdByEmail: (email: EmailAddress) => identity.userIdByEmail.execute(email),
  };
}
