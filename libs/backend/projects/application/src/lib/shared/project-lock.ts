import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import {
  canOnProject,
  effectiveProjectRole,
  type OrganizationRole,
  type ProjectPermission,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import type {
  Project,
  ProjectMember,
  ProjectMemberRepository,
  ProjectRepository,
} from '@taskflow/backend/projects/domain';
import type { OrganizationAccess, OrganizationAccessSnapshot } from '../ports/organization-access';
import {
  InsufficientRoleError,
  OrganizationNotFoundError,
  ProjectNotFoundError,
} from './projects-errors';

export type LockedProject = Readonly<{
  access: OrganizationAccessSnapshot;
  actorOrganizationRole: OrganizationRole;
  project: Project;
  actorParticipation: ProjectMember | null;
  actorEffectiveRole: ProjectRole;
}>;

/**
 * Ordem única de locks e de decisão das escritas (design da spec 003). Só dentro de transação:
 * 1. organização `FOR SHARE` e ator relido (404 `ORGANIZATION_NOT_FOUND` se removido);
 * 2. projeto `FOR NO KEY UPDATE` e visível ao ator relido (404 `PROJECT_NOT_FOUND`);
 * 3. permissão sobre o papel efetivo relido (403).
 * Arquivado, versão, alvo, teto e duplicidade ficam com o chamador, nessa ordem.
 */
export async function lockProjectAndRereadActor(
  deps: {
    readonly organizationAccess: OrganizationAccess;
    readonly projects: ProjectRepository;
    readonly projectMembers: ProjectMemberRepository;
  },
  context: TenantRequestContext,
  input: Readonly<{
    projectId: string;
    permission: ProjectPermission;
    /** Outros usuários cujo papel na organização a decisão precisa (alvos). */
    alsoRead?: ReadonlyArray<string>;
  }>,
): Promise<LockedProject> {
  const { organizationId } = context.tenant;
  const actorUserId = context.actor.userId;
  const access = await deps.organizationAccess.lockForShare(organizationId, [
    actorUserId,
    ...(input.alsoRead ?? []),
  ]);
  const actorOrganizationRole = access?.roles.get(actorUserId);
  if (!access || !actorOrganizationRole) throw new OrganizationNotFoundError();

  const project = await deps.projects.lockForUpdate(organizationId, input.projectId);
  if (!project) throw new ProjectNotFoundError();
  const actorParticipation = await deps.projectMembers.find(
    organizationId,
    input.projectId,
    actorUserId,
  );
  const actorEffectiveRole = effectiveProjectRole(
    actorOrganizationRole,
    actorParticipation?.role ?? null,
  );
  if (!actorEffectiveRole) throw new ProjectNotFoundError();
  if (!canOnProject(actorEffectiveRole, input.permission, { ownsResource: false })) {
    throw new InsufficientRoleError();
  }
  return { access, actorOrganizationRole, project, actorParticipation, actorEffectiveRole };
}
