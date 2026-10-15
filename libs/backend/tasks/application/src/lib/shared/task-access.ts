import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import type { ProjectRole } from '@taskflow/backend/shared/kernel';
import { parseTaskKey, TaskNotFoundError, type Task } from '@taskflow/backend/tasks/domain';
import type { LockedProject } from '../ports/project-access';
import type { TaskProjectContext } from './task-views';
import {
  InsufficientRoleError,
  OrganizationNotFoundError,
  ProjectArchivedError,
} from './tasks-errors';
import type { TasksDependencies } from './tasks-dependencies';

export type TaskForWrite = Readonly<{
  task: Task;
  locked: LockedProject;
  projectLocked: boolean;
  project: TaskProjectContext;
}>;

/**
 * Rotas endereçadas por tarefa (design, ordem de decisão): tarefa inexistente, de projeto sem
 * acesso ou apagada no meio ⇒ o mesmo 404 `TASK_NOT_FOUND`; depois permissão (403); depois
 * projeto arquivado (409). Locks na ordem única: projeto e memberships `FOR SHARE` (por
 * `projects`) → lock do projeto em `tasks` (se pedido) → **uma** linha de tarefa. Só em transação.
 */
export async function lockTaskForWrite(
  deps: Pick<TasksDependencies, 'tasks' | 'projectAccess'>,
  context: TenantRequestContext,
  taskId: string,
  options: Readonly<{
    /** Decisão de permissão sobre a tarefa relida sob lock. */
    authorize: (role: ProjectRole, task: Task) => boolean | Promise<boolean>;
    /** Outras pessoas cujo papel precisa ser relido sob lock (ex.: o novo responsável). */
    alsoLock?: ReadonlyArray<string>;
    /**
     * Invariantes entre tarefas (BR-001, BR-006, limites): lock do projeto em `tasks`. Como função,
     * decide pela tarefa lida **antes** do lock (a ordem dos locks não permite relê-la antes); quem
     * usa confere a decisão depois com `projectLocked`.
     */
    lockProject: boolean | ((locked: LockedProject, found: Task) => boolean);
  }>,
): Promise<TaskForWrite> {
  const { organizationId } = context.tenant;
  const actorUserId = context.actor.userId;
  const found = await deps.tasks.findById(organizationId, taskId);
  if (!found) throw new TaskNotFoundError();
  const locked = await deps.projectAccess.lockForContribution(
    organizationId,
    { projectId: found.projectId },
    [actorUserId, ...(options.alsoLock ?? [])],
  );
  if (!locked) throw new TaskNotFoundError();
  if (!locked.organizationMembers.has(actorUserId)) throw new OrganizationNotFoundError();
  const role = locked.effectiveRoles.get(actorUserId) ?? null;
  if (!role) throw new TaskNotFoundError();
  const projectLocked =
    typeof options.lockProject === 'function'
      ? options.lockProject(locked, found)
      : options.lockProject;
  if (projectLocked) await deps.tasks.lockProject(organizationId, locked.projectId);
  const task = await deps.tasks.lockById(organizationId, locked.projectId, taskId);
  if (!task) throw new TaskNotFoundError();
  if (!(await options.authorize(role, task))) throw new InsufficientRoleError();
  if (locked.archived) throw new ProjectArchivedError();
  return {
    task,
    locked,
    projectLocked,
    project: {
      projectId: locked.projectId,
      key: locked.key,
      archived: locked.archived,
      workflow: locked.workflow,
      effectiveRole: role,
    },
  };
}

export type TaskLookup = Readonly<{ taskId: string } | { key: string }>;

/** Leitura por id ou `CHAVE-N`: sem acesso, inexistente ou chave malformada ⇒ o mesmo 404. */
export async function findTaskForRead(
  deps: Pick<TasksDependencies, 'tasks' | 'projectAccess'>,
  context: TenantRequestContext,
  lookup: TaskLookup,
): Promise<Readonly<{ task: Task; project: TaskProjectContext }>> {
  const { organizationId, organizationRole } = context.tenant;
  const viewer = { userId: context.actor.userId, organizationRole };
  if ('taskId' in lookup) {
    const task = await deps.tasks.findById(organizationId, lookup.taskId);
    const project = task
      ? await deps.projectAccess.resolveForRead(
          organizationId,
          { projectId: task.projectId },
          viewer,
        )
      : null;
    if (!task || !project) throw new TaskNotFoundError();
    return { task, project };
  }
  const key = parseTaskKey(lookup.key);
  if (!key) throw new TaskNotFoundError();
  const project = await deps.projectAccess.resolveForRead(
    organizationId,
    { key: key.projectKey },
    viewer,
  );
  const task = project
    ? await deps.tasks.findByNumber(organizationId, project.projectId, key.number)
    : null;
  if (!project || !task) throw new TaskNotFoundError();
  return { task, project };
}

/** Grafo "bloqueada por" com a aresta implícita D4 (pai bloqueado pelas subtarefas obrigatórias). */
export function blockedByExpander(
  deps: Pick<TasksDependencies, 'tasks' | 'dependencies'>,
  organizationId: string,
  projectId: string,
) {
  return async (taskIds: ReadonlyArray<string>): Promise<ReadonlyArray<string>> => {
    const [explicit, implicit] = await Promise.all([
      deps.dependencies.blockersOf(organizationId, projectId, taskIds),
      deps.tasks.requiredSubtaskIds(organizationId, projectId, taskIds),
    ]);
    return [...explicit, ...implicit];
  };
}
