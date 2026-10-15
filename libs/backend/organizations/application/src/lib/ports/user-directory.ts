import type { EmailAddress } from '@taskflow/backend/shared/kernel';

/** Conta de usuário vista por `organizations`; os dados vivem no contexto `identity`. */
export interface UserAccount {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/** Teto de ids por consulta; casos de uso paginam antes de consultar (limite espelhado em `identity`). */
export const MAX_USER_ACCOUNTS_PER_QUERY = 100;

/**
 * Porta para contas de usuário (spec 002, design "Dados de usuários nos membros"). O composition
 * root (`apps/api` e `apps/worker`) liga um adaptador aos casos de uso de `identity`; este contexto
 * nunca lê a tabela `users`.
 */
export interface UserDirectory {
  /** Contas existentes entre os ids, indexadas pelo id; ids inexistentes ficam de fora. */
  getAccounts(userIds: readonly string[]): Promise<ReadonlyMap<string, UserAccount>>;
  /** Id da conta com o e-mail (já normalizado pelo `EmailAddress`), ou `null`. */
  findUserIdByEmail(email: EmailAddress): Promise<string | null>;
}
