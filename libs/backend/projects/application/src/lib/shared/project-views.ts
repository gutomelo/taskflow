import type { ProjectPermission, ProjectRole } from '@taskflow/backend/shared/kernel';
import { projectCapabilities, type Project } from '@taskflow/backend/projects/domain';

export type ProjectView = Readonly<{
  id: string;
  key: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  /** Papel efetivo (BR-023). */
  myRole: ProjectRole;
  /** Dica de interface (spec 006); a API decide toda ação. */
  capabilities: ReadonlyArray<ProjectPermission>;
}>;

export type ProjectSummaryView = Readonly<{
  id: string;
  key: string;
  name: string;
  archived: boolean;
  myRole: ProjectRole;
}>;

/** `version` explícita depois de gravar (`save` grava `version + 1`). */
export function toProjectView(
  project: Project,
  myRole: ProjectRole,
  version = project.version,
): ProjectView {
  const { id, key, name, description, archivedAt, createdAt } = project.toSnapshot();
  return {
    id,
    key: key.value,
    name: name.value,
    description,
    archivedAt,
    version,
    createdAt,
    myRole,
    capabilities: projectCapabilities(myRole, { archived: archivedAt !== null }),
  };
}

export function toProjectSummaryView(project: Project, myRole: ProjectRole): ProjectSummaryView {
  const { id, key, name, archivedAt } = project.toSnapshot();
  return { id, key: key.value, name: name.value, archived: archivedAt !== null, myRole };
}
