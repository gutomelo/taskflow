import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';
import { formatTaskKey } from '@taskflow/backend/tasks/domain';
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

/** Teto de tarefas por consulta em lote (uma página de notificações). */
export const MAX_VISIBLE_TASKS_QUERY = 200;

/**
 * Spec 008 (porta `NotificationTargets`): quais das tarefas dadas o leitor vê agora, com chave e
 * título — numa consulta de tarefas e uma de projetos. Ausente do mapa = não visível (falha
 * fechado): tarefa excluída, de outra organização ou de projeto sem leitura.
 */
export class ResolveVisibleTasksUseCase {
  // Só `readableProjects`: o worker (resumo) monta este caso de uso sem o resto da porta.
  constructor(
    private readonly deps: Pick<TasksDependencies, 'tasks'> &
      Readonly<{ projectAccess: Pick<TasksDependencies['projectAccess'], 'readableProjects'> }>,
  ) {}

  async execute(
    organizationId: string,
    viewer: Readonly<{ userId: string; organizationRole: OrganizationRole }>,
    taskIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, Readonly<{ key: string; title: string }>>> {
    const unique = [...new Set(taskIds)];
    if (unique.length > MAX_VISIBLE_TASKS_QUERY) {
      throw new RangeError(`At most ${MAX_VISIBLE_TASKS_QUERY} tasks per query`);
    }
    if (unique.length === 0) return new Map();
    const tasks = await this.deps.tasks.findAnyByIds(organizationId, unique);
    if (tasks.length === 0) return new Map();
    const projects = await this.deps.projectAccess.readableProjects(
      organizationId,
      [...new Set(tasks.map((task) => task.projectId))],
      viewer,
    );
    return new Map(
      tasks.flatMap((task) => {
        const project = projects.get(task.projectId);
        if (!project) return [];
        const { number, title } = task.toSnapshot();
        return [
          [task.id, { key: formatTaskKey(project.key, number), title: title.value }] as const,
        ];
      }),
    );
  }
}
