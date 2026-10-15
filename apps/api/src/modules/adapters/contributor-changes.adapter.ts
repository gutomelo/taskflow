import type { ProjectContributorChanges } from '@taskflow/backend/projects/application';
import type { RevokeAssignmentsOnAccessLossUseCase } from '@taskflow/backend/tasks/application';

/**
 * Porta `ProjectContributorChanges` de `projects` ligada à revogação de atribuições de `tasks`
 * (BR-003, spec 004). Roda na transação de quem originou (mesma instância do runner).
 */
export function createContributorChanges(tasks: {
  readonly revokeAssignmentsOnAccessLoss: Pick<RevokeAssignmentsOnAccessLossUseCase, 'execute'>;
}): ProjectContributorChanges {
  return {
    async contributorAccessReduced(change) {
      await tasks.revokeAssignmentsOnAccessLoss.execute(change);
    },
  };
}
