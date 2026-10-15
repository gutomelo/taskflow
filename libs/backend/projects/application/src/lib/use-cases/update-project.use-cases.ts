import type { TenantRequestContext, TransactionRunner } from '@taskflow/backend/shared/application';
import { VersionConflictError, type Clock } from '@taskflow/backend/shared/kernel';
import {
  parseProjectDescription,
  ProjectArchivedError,
  ProjectName,
  type ProjectMemberRepository,
  type ProjectRepository,
} from '@taskflow/backend/projects/domain';
import type { OrganizationAccess } from '../ports/organization-access';
import { lockProjectAndRereadActor } from '../shared/project-lock';
import { toProjectView, type ProjectView } from '../shared/project-views';
import type { ProjectsSecurityEventRecorder } from '../shared/projects-security-events';

export interface ProjectWriteDependencies {
  readonly organizationAccess: OrganizationAccess;
  readonly projects: ProjectRepository;
  readonly projectMembers: ProjectMemberRepository;
  readonly transactions: TransactionRunner;
  readonly securityEvents: ProjectsSecurityEventRecorder;
  readonly clock: Clock;
}

/** Pelo menos um campo (o contrato HTTP também garante). */
export type UpdateProjectCommand = Readonly<{
  projectId: string;
  name?: string;
  description?: string | null;
  version: number;
}>;

/** RF-04 (BR-008, BR-026): nome e descrição; a chave nunca muda. */
export class UpdateProjectUseCase {
  constructor(private readonly deps: ProjectWriteDependencies) {}

  async execute(
    context: TenantRequestContext,
    command: UpdateProjectCommand,
  ): Promise<ProjectView> {
    const name = command.name === undefined ? undefined : ProjectName.create(command.name);
    const description =
      command.description === undefined ? undefined : parseProjectDescription(command.description);

    const { project, myRole } = await this.deps.transactions.run(async () => {
      const locked = await lockProjectAndRereadActor(this.deps, context, {
        projectId: command.projectId,
        permission: 'project:update',
      });
      if (locked.project.isArchived) throw new ProjectArchivedError();
      if (locked.project.version !== command.version) throw new VersionConflictError('Project');
      locked.project.update(
        {
          ...(name === undefined ? {} : { name }),
          ...(description === undefined ? {} : { description }),
        },
        this.deps.clock.now(),
      );
      await this.deps.projects.save(locked.project);
      return { project: locked.project, myRole: locked.actorEffectiveRole };
    });

    this.record(context, 'projects.updated', project.id);
    return toProjectView(project, myRole, project.version + 1);
  }

  private record(context: TenantRequestContext, type: 'projects.updated', projectId: string) {
    this.deps.securityEvents.record({
      type,
      requestId: context.requestId,
      organizationId: context.tenant.organizationId,
      actorUserId: context.actor.userId,
      projectId,
    });
  }
}

export type ArchiveProjectCommand = Readonly<{ projectId: string; version: number }>;

/**
 * RF-05 (BR-026, BR-008): arquivar e restaurar com `project:archive`. Já no estado pedido ⇒ 200
 * com a versão atual, **sem** checar a versão (idempotente); senão, a versão precisa bater.
 */
abstract class ChangeArchiveStateUseCase {
  protected abstract readonly archive: boolean;

  constructor(private readonly deps: ProjectWriteDependencies) {}

  async execute(
    context: TenantRequestContext,
    command: ArchiveProjectCommand,
  ): Promise<ProjectView> {
    const outcome = await this.deps.transactions.run(async () => {
      const locked = await lockProjectAndRereadActor(this.deps, context, {
        projectId: command.projectId,
        permission: 'project:archive',
      });
      const { project } = locked;
      if (project.isArchived === this.archive) {
        return { project, myRole: locked.actorEffectiveRole, changed: false };
      }
      if (project.version !== command.version) throw new VersionConflictError('Project');
      const now = this.deps.clock.now();
      if (this.archive) project.archive(now);
      else project.restore(now);
      await this.deps.projects.save(project);
      return { project, myRole: locked.actorEffectiveRole, changed: true };
    });

    const { project, myRole, changed } = outcome;
    if (changed) {
      this.deps.securityEvents.record({
        type: this.archive ? 'projects.archived' : 'projects.restored',
        requestId: context.requestId,
        organizationId: context.tenant.organizationId,
        actorUserId: context.actor.userId,
        projectId: project.id,
      });
    }
    return toProjectView(project, myRole, changed ? project.version + 1 : project.version);
  }
}

export class ArchiveProjectUseCase extends ChangeArchiveStateUseCase {
  protected readonly archive = true;
}

export class RestoreProjectUseCase extends ChangeArchiveStateUseCase {
  protected readonly archive = false;
}
