import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import type { ProjectRepository, Workflow } from '@taskflow/backend/projects/domain';
import { findReadableProject, type ProjectLookup } from '../shared/project-read';
import { toProjectView, type ProjectView } from '../shared/project-views';

export type { ProjectLookup } from '../shared/project-read';

/** RF-03: por id ou por chave, com papel efetivo e capacidades. */
export class GetProjectUseCase {
  constructor(private readonly deps: { readonly projects: ProjectRepository }) {}

  async execute(context: TenantRequestContext, by: ProjectLookup): Promise<ProjectView> {
    const { project, myRole } = await findReadableProject(this.deps.projects, context, by);
    return toProjectView(project, myRole);
  }
}

/** RF-09: workflow (só leitura nesta spec) para quem lê o projeto. */
export class GetWorkflowUseCase {
  constructor(private readonly deps: { readonly projects: ProjectRepository }) {}

  async execute(context: TenantRequestContext, projectId: string): Promise<Workflow> {
    await findReadableProject(this.deps.projects, context, { projectId });
    return this.deps.projects.findWorkflow(context.tenant.organizationId, projectId);
  }
}
