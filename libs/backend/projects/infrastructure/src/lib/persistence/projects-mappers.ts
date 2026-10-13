import { isProjectRole, type ProjectRole } from '@taskflow/backend/shared/kernel';
import {
  Project,
  ProjectKey,
  ProjectMember,
  ProjectName,
  STATUS_CATEGORIES,
  type StatusCategory,
  type Workflow,
} from '@taskflow/backend/projects/domain';
import type {
  ProjectMemberRow,
  ProjectRow,
  WorkflowStatusRow,
  WorkflowTransitionRow,
} from '@taskflow/backend/shared/infrastructure';

/** Papel lido do banco: valor fora do enum é dado corrompido — falha alto, nunca concede. */
export function projectRoleFrom(value: string): ProjectRole {
  if (!isProjectRole(value)) throw new Error(`Unknown project role in database: ${value}`);
  return value;
}

function categoryFrom(value: string): StatusCategory {
  const category = STATUS_CATEGORIES.find((known) => known === value);
  if (!category) throw new Error(`Unknown status category in database: ${value}`);
  return category;
}

export function toProject(row: ProjectRow): Project {
  return Project.restore({
    id: row.id,
    organizationId: row.organizationId,
    key: ProjectKey.create(row.key),
    name: ProjectName.create(row.name),
    description: row.description,
    archivedAt: row.archivedAt,
    createdByUserId: row.createdByUserId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toProjectMember(row: ProjectMemberRow): ProjectMember {
  return ProjectMember.restore({
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    userId: row.userId,
    role: projectRoleFrom(row.role),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toWorkflow(
  statuses: ReadonlyArray<WorkflowStatusRow>,
  transitions: ReadonlyArray<WorkflowTransitionRow>,
): Workflow {
  return {
    statuses: statuses.map((status) => ({
      id: status.id,
      name: status.name,
      category: categoryFrom(status.category),
      position: status.position,
    })),
    transitions: transitions.map(({ fromStatusId, toStatusId }) => ({ fromStatusId, toStatusId })),
  };
}
