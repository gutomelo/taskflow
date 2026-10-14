import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';
import type { TasksDependencies } from '../shared/tasks-dependencies';

// Casos de uso que servem à porta `TaskDiscussionAccess` de `collaboration` (spec 010), ligada no
// composition root. Não são expostos por HTTP e **não decidem permissão**: devolvem dados (ou
// `null` = tarefa inexistente ou sem leitura); quem decide 404/403/estado é `collaboration`.

/** Tarefa travada para uma escrita de comentário, com os papéis relidos sob lock. */
export type TaskDiscussionLock = Readonly<{
  taskId: string;
  projectId: string;
  archived: boolean;
  canceled: boolean;
  /** Papel efetivo de cada pessoa pedida; `null` = não lê o projeto (ou não é mais membro). */
  effectiveRoles: ReadonlyMap<string, ProjectRole | null>;
}>;

/**
 * Ordem única de locks: projeto `FOR SHARE` e memberships `FOR SHARE` (por `projects`) → linha da
 * tarefa `FOR SHARE` (nunca `task_project_locks`). Só em transação.
 */
export class LockTaskForDiscussionUseCase {
  constructor(private readonly deps: Pick<TasksDependencies, 'tasks' | 'projectAccess'>) {}

  async execute(
    organizationId: string,
    taskId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<TaskDiscussionLock | null> {
    const found = await this.deps.tasks.findById(organizationId, taskId);
    if (!found) return null;
    const locked = await this.deps.projectAccess.lockForContribution(
      organizationId,
      { projectId: found.projectId },
      userIds,
    );
    if (!locked) return null;
    const task = await this.deps.tasks.lockForShare(organizationId, locked.projectId, taskId);
    if (!task) return null;
    return {
      taskId: task.id,
      projectId: locked.projectId,
      archived: locked.archived,
      canceled: task.isCanceled,
      // `projects` já devolve `null` para quem não é (mais) membro da organização.
      effectiveRoles: new Map(
        userIds.map((userId) => [userId, locked.effectiveRoles.get(userId) ?? null]),
      ),
    };
  }
}

/** Tarefa visível ao leitor (sem lock). */
export type TaskDiscussionView = Readonly<{
  taskId: string;
  projectId: string;
  archived: boolean;
  canceled: boolean;
  effectiveRole: ProjectRole;
}>;

/** Leitura: `null` = tarefa inexistente ou de projeto sem leitura (o mesmo para quem chama). */
export class ResolveTaskForDiscussionUseCase {
  constructor(private readonly deps: Pick<TasksDependencies, 'tasks' | 'projectAccess'>) {}

  async execute(
    organizationId: string,
    taskId: string,
    viewer: Readonly<{ userId: string; organizationRole: OrganizationRole }>,
  ): Promise<TaskDiscussionView | null> {
    const task = await this.deps.tasks.findById(organizationId, taskId);
    if (!task) return null;
    const project = await this.deps.projectAccess.resolveForRead(
      organizationId,
      { projectId: task.projectId },
      viewer,
    );
    if (!project) return null;
    return {
      taskId: task.id,
      projectId: project.projectId,
      archived: project.archived,
      canceled: task.isCanceled,
      effectiveRole: project.effectiveRole,
    };
  }
}
