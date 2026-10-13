import {
  effectiveProjectRole,
  type OrganizationRole,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import {
  assignableProjectRoles,
  participantActions,
  type ParticipantActions,
  type ProjectMember,
} from '@taskflow/backend/projects/domain';
import type { ProjectUserAccount } from '../ports/user-directory';

export type ProjectMemberView = Readonly<{
  userId: string;
  /** `null` se a conta não estiver disponível (removida em `identity`). */
  name: string | null;
  email: string | null;
  /** Papel gravado no projeto. */
  role: ProjectRole;
  /** Papel efetivo (BR-023): o gravado limitado pelo papel na organização. */
  effectiveRole: ProjectRole;
  version: number;
  joinedAt: Date;
  /** Dica de interface (spec 006): o caso de uso decide sob lock. */
  actions: ParticipantActions;
}>;

export type MemberCandidateView = Readonly<{
  userId: string;
  name: string | null;
  email: string | null;
  organizationRole: OrganizationRole;
  /** Papéis que podem ser gravados para ele (teto, BR-027). */
  allowedRoles: ReadonlyArray<ProjectRole>;
}>;

/** Quem está vendo: papel efetivo no projeto e se o projeto está arquivado. */
export type ParticipantViewer = Readonly<{
  userId: string;
  effectiveRole: ProjectRole;
  archived: boolean;
}>;

export function toProjectMemberView(
  member: ProjectMember,
  targetOrganizationRole: OrganizationRole,
  account: ProjectUserAccount | undefined,
  viewer: ParticipantViewer,
  version = member.version,
): ProjectMemberView {
  return {
    userId: member.userId,
    name: account?.name ?? null,
    email: account?.email ?? null,
    role: member.role,
    // Participação sempre tem papel gravado válido: o efetivo nunca é `null` aqui.
    effectiveRole: effectiveProjectRole(targetOrganizationRole, member.role) ?? 'viewer',
    version,
    joinedAt: member.joinedAt,
    actions: participantActions({
      actorEffectiveRole: viewer.effectiveRole,
      targetRole: member.role,
      targetOrganizationRole,
      isSelf: member.userId === viewer.userId,
      archived: viewer.archived,
    }),
  };
}

export function toMemberCandidateView(
  userId: string,
  organizationRole: OrganizationRole,
  account: ProjectUserAccount | undefined,
): MemberCandidateView {
  return {
    userId,
    name: account?.name ?? null,
    email: account?.email ?? null,
    organizationRole,
    allowedRoles: assignableProjectRoles(organizationRole),
  };
}
