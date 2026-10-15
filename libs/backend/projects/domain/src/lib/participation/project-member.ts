import {
  PROJECT_ROLES,
  type OrganizationRole,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import { AlreadyManagesAllProjectsError, ProjectRoleAboveCeilingError } from '../errors';

/**
 * BR-023/BR-027: papéis que podem ser gravados para alguém, dado o papel dele na organização.
 * Owner/admin: nenhum (já gerenciam todos os projetos — D1); viewer: só `viewer` (teto);
 * member: todos.
 */
export function assignableProjectRoles(
  organizationRole: OrganizationRole,
): ReadonlyArray<ProjectRole> {
  switch (organizationRole) {
    case 'owner':
    case 'admin':
      return [];
    case 'member':
      return PROJECT_ROLES;
    case 'viewer':
      return ['viewer'];
    default: {
      const unreachable: never = organizationRole;
      return unreachable;
    }
  }
}

function assertAssignable(role: ProjectRole, organizationRole: OrganizationRole): void {
  if (organizationRole === 'owner' || organizationRole === 'admin') {
    throw new AlreadyManagesAllProjectsError();
  }
  if (!assignableProjectRoles(organizationRole).includes(role)) {
    throw new ProjectRoleAboveCeilingError();
  }
}

export type ProjectMemberSnapshot = Readonly<{
  id: string;
  organizationId: string;
  projectId: string;
  /** Membro da organização (FK composta para `memberships`, ADR 0015). */
  userId: string;
  role: ProjectRole;
  /** Optimistic locking (BR-008), incrementado pelo repositório ao gravar. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

/** Participação de um membro da organização num projeto, com papel limitado pelo teto. */
export class ProjectMember {
  private constructor(private state: ProjectMemberSnapshot) {}

  static create(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly userId: string;
    readonly role: ProjectRole;
    /** Papel do alvo na organização, relido sob lock. */
    readonly organizationRole: OrganizationRole;
    readonly now: Date;
  }): ProjectMember {
    const { organizationRole, now, ...rest } = input;
    assertAssignable(rest.role, organizationRole);
    return new ProjectMember({ ...rest, version: 1, createdAt: now, updatedAt: now });
  }

  static restore(snapshot: ProjectMemberSnapshot): ProjectMember {
    return new ProjectMember(snapshot);
  }

  get userId(): string {
    return this.state.userId;
  }

  get role(): ProjectRole {
    return this.state.role;
  }

  get version(): number {
    return this.state.version;
  }

  get joinedAt(): Date {
    return this.state.createdAt;
  }

  changeRole(role: ProjectRole, organizationRole: OrganizationRole, now: Date): void {
    assertAssignable(role, organizationRole);
    this.state = { ...this.state, role, updatedAt: now };
  }

  toSnapshot(): ProjectMemberSnapshot {
    return this.state;
  }
}
