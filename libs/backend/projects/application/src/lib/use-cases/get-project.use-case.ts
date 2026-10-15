import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import type { ProjectRepository } from '@taskflow/backend/projects/domain';
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
