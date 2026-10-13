import {
  toPageRequest,
  type PageQuery,
  type TenantRequestContext,
} from '@taskflow/backend/shared/application';
import { effectiveProjectRole } from '@taskflow/backend/shared/kernel';
import type { ProjectRepository } from '@taskflow/backend/projects/domain';
import { viewerOf } from '../shared/project-read';
import { toProjectSummaryView, type ProjectSummaryView } from '../shared/project-views';

export type ListProjectsQuery = PageQuery & Readonly<{ archived?: boolean }>;

/**
 * RF-02: projetos visíveis, por nome; ativos por padrão. Leitura com o papel do contexto da
 * requisição (uma consulta por requisição, ADR 0012); a janela de papel antigo é aceita.
 */
export class ListProjectsUseCase {
  constructor(private readonly deps: { readonly projects: ProjectRepository }) {}

  async execute(
    context: TenantRequestContext,
    query: ListProjectsQuery,
  ): Promise<{ items: ProjectSummaryView[]; nextCursor: string | null }> {
    const page = await this.deps.projects.listVisiblePage(
      context.tenant.organizationId,
      { viewer: viewerOf(context), archived: query.archived ?? false },
      toPageRequest(query),
    );
    return {
      items: page.items.flatMap(({ project, participation }) => {
        const myRole = effectiveProjectRole(context.tenant.organizationRole, participation);
        return myRole ? [toProjectSummaryView(project, myRole)] : [];
      }),
      nextCursor: page.nextCursor,
    };
  }
}
