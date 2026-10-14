import type {
  ListAssignableUsersUseCase,
  LockProjectForContributionUseCase,
  ResolveProjectForReadUseCase,
} from '@taskflow/backend/projects/application';
import type { ProjectAccess } from '@taskflow/backend/tasks/application';
import type { WorkflowView } from '@taskflow/backend/tasks/domain';

type ProjectsWorkflow = Readonly<{
  statuses: ReadonlyArray<WorkflowView['statuses'][number]>;
  transitions: ReadonlyArray<WorkflowView['transitions'][number]>;
}>;

/** Cópia explícita: `tasks` recebe só o que a porta declara, não o tipo de `projects`. */
const toWorkflowView = (workflow: ProjectsWorkflow): WorkflowView => ({
  statuses: workflow.statuses.map(({ id, name, category, position }) => ({
    id,
    name,
    category,
    position,
  })),
  transitions: workflow.transitions.map(({ fromStatusId, toStatusId }) => ({
    fromStatusId,
    toStatusId,
  })),
});

/**
 * Porta `ProjectAccess` de `tasks` ligada aos casos de uso de contribuição de `projects` (spec
 * 004). Roda na transação de quem chama (mesma instância do runner).
 */
export function createProjectAccess(projects: {
  readonly contribution: Readonly<{
    lockForContribution: Pick<LockProjectForContributionUseCase, 'execute'>;
    resolveForRead: Pick<ResolveProjectForReadUseCase, 'execute'>;
    assignableUsers: Pick<ListAssignableUsersUseCase, 'execute'>;
  }>;
}): ProjectAccess {
  const { contribution } = projects;
  return {
    async lockForContribution(organizationId, lookup, userIds) {
      const locked = await contribution.lockForContribution.execute(
        organizationId,
        lookup,
        userIds,
      );
      return locked && { ...locked, workflow: toWorkflowView(locked.workflow) };
    },
    async resolveForRead(organizationId, lookup, viewer) {
      const readable = await contribution.resolveForRead.execute(organizationId, lookup, viewer);
      return readable && { ...readable, workflow: toWorkflowView(readable.workflow) };
    },
    assignableUsers(organizationId, projectId, page) {
      return contribution.assignableUsers.execute(organizationId, projectId, page);
    },
  };
}
