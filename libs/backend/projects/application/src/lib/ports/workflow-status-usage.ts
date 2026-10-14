/**
 * Porta para `tasks` (spec 005), na linguagem de `projects`: quantas tarefas cada status tem e
 * reatribuir as tarefas de um status removido. Ligada no composition root à fundação de `tasks`;
 * roda na transação de `projects` (projeto travado `FOR NO KEY UPDATE`).
 */
export interface WorkflowStatusUsage {
  /** Todas as tarefas por status (canceladas e subtarefas incluídas). Ausente = 0. */
  statusUsage(organizationId: string, projectId: string): Promise<ReadonlyMap<string, number>>;
  /** Move todas as tarefas de `fromStatusId` para `toStatusId` (mesma categoria); devolve quantas. */
  reassignStatus(
    organizationId: string,
    projectId: string,
    fromStatusId: string,
    toStatusId: string,
  ): Promise<number>;
}
