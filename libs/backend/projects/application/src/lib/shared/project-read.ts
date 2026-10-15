import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import {
  canOnProject,
  effectiveProjectRole,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import type { Project, ProjectRepository, ProjectViewer } from '@taskflow/backend/projects/domain';
import { ProjectNotFoundError } from './projects-errors';

export type ProjectLookup = Readonly<{ projectId: string } | { key: string }>;

/** BR-023: owner/admin veem todos os projetos; os demais só os que participam. */
export function viewerOf(context: TenantRequestContext): ProjectViewer {
  const { organizationRole } = context.tenant;
  return {
    userId: context.actor.userId,
    seesAll: organizationRole === 'owner' || organizationRole === 'admin',
  };
}

/**
 * Leitura: projeto visível ao leitor numa única consulta (sem diferença entre "não existe" e
 * "sem acesso"), com o papel efetivo calculado sobre o papel do contexto da requisição (uma
 * consulta por requisição, ADR 0012). Sem acesso ⇒ 404.
 */
export async function findReadableProject(
  projects: ProjectRepository,
  context: TenantRequestContext,
  by: ProjectLookup,
): Promise<Readonly<{ project: Project; myRole: ProjectRole }>> {
  const visible = await projects.findVisible(context.tenant.organizationId, by, viewerOf(context));
  const myRole = visible
    ? effectiveProjectRole(context.tenant.organizationRole, visible.participation)
    : null;
  if (!visible || !myRole || !canOnProject(myRole, 'project:read', { ownsResource: false })) {
    throw new ProjectNotFoundError();
  }
  return { project: visible.project, myRole };
}
