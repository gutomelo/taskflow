/** Conta de usuário exibida em listas de participantes (dados de `identity`). */
export type ProjectUserAccount = Readonly<{ id: string; name: string; email: string }>;

/** Consulta de contas em lote (uma chamada por página), ligada a `identity` no composition root. */
export interface UserDirectory {
  getAccounts(userIds: ReadonlyArray<string>): Promise<ReadonlyMap<string, ProjectUserAccount>>;
}
