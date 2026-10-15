/** Nome exibido do responsável (dados de `identity`), em lote: uma chamada por resposta. */
export interface TaskUserDirectory {
  getNames(userIds: ReadonlyArray<string>): Promise<ReadonlyMap<string, string>>;
}
