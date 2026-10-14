/**
 * Avisa, **na mesma transação**, que alguém deixou de poder contribuir (papel efetivo deixou de
 * ser `manager`/`member`) — spec 004, BR-003. Escrita na linguagem de `projects`: quem reage (hoje
 * `tasks`, que desfaz atribuições) não recalcula papéis; a decisão é toda daqui, com
 * `effectiveProjectRole` do kernel. Ligada no composition root.
 *
 * Contrato: só chamada dentro de `TransactionRunner.run`, com a mesma instância do runner.
 */
export interface ProjectContributorChanges {
  contributorAccessReduced(
    change: Readonly<{
      organizationId: string;
      userId: string;
      /** Um projeto, ou a organização inteira exceto `stillContributorIn`. */
      scope: Readonly<{ projectId: string }> | 'organization';
      stillContributorIn: ReadonlyArray<string>;
    }>,
  ): Promise<void>;
}
