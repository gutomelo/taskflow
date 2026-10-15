import type { WorkflowStatusUsage } from '@taskflow/backend/projects/application';
import type {
  CountTasksByStatusUseCase,
  ReassignTasksStatusUseCase,
} from '@taskflow/backend/tasks/application';

/**
 * Porta `WorkflowStatusUsage` de `projects` ligada à fundação de `tasks` (spec 005, I2): só
 * repositórios de `tasks`, montados antes de `projects` — sem ciclo de construção. Roda na
 * transação de `projects` (mesma instância do runner).
 */
export function createWorkflowStatusUsage(tasks: {
  readonly countTasksByStatus: Pick<CountTasksByStatusUseCase, 'execute'>;
  readonly reassignTasksStatus: Pick<ReassignTasksStatusUseCase, 'execute'>;
}): WorkflowStatusUsage {
  return {
    statusUsage: (organizationId, projectId) =>
      tasks.countTasksByStatus.execute(organizationId, projectId),
    reassignStatus: (organizationId, projectId, fromStatusId, toStatusId) =>
      tasks.reassignTasksStatus.execute(organizationId, projectId, fromStatusId, toStatusId),
  };
}
