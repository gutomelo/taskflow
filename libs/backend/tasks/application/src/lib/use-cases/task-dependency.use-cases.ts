import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import { canOnProject } from '@taskflow/backend/shared/kernel';
import {
  assertNoCycle,
  DependencyLimitReachedError,
  TaskCanceledError,
  TaskNotFoundError,
} from '@taskflow/backend/tasks/domain';
import { blockedByExpander, lockTaskForWrite } from '../shared/task-access';
import {
  MAX_BLOCKERS_PER_TASK,
  MAX_DEPENDENCIES_PER_PROJECT,
  TASK_WRITE_POLICY,
} from '../shared/task-limits';
import { loadTaskView, type TaskView } from '../shared/task-views';
import { eventBase, runTaskMutation } from '../shared/task-write';
import type { TasksDependencies } from '../shared/tasks-dependencies';
import { DependencyNotFoundError } from '../shared/tasks-errors';

export type DependencyCommand = Readonly<{ taskId: string; blockingTaskId: string }>;

const lockOptions = {
  authorize: (role: Parameters<typeof canOnProject>[0]) =>
    canOnProject(role, 'task:update', { ownsResource: false }),
  // Ciclos e tetos são invariantes entre tarefas: lock do projeto em `tasks`.
  lockProject: true,
} as const;

/**
 * RF-08 (BR-006 com D4, D2): "`taskId` bloqueada por `blockingTaskId`", no mesmo projeto. Duplicada
 * ⇒ idempotente (`created: false`, HTTP 200). Tarefa concluída pode ganhar bloqueadora (D2).
 */
export class AddDependencyUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  execute(
    context: TenantRequestContext,
    command: DependencyCommand,
  ): Promise<Readonly<{ task: TaskView; created: boolean }>> {
    const { organizationId } = context.tenant;
    return runTaskMutation(this.deps, context, TASK_WRITE_POLICY, async () => {
      const { task, project } = await lockTaskForWrite(
        this.deps,
        context,
        command.taskId,
        lockOptions,
      );
      if (task.isCanceled) throw new TaskCanceledError();
      const { projectId } = project;
      const [blocking] = await this.deps.tasks.findByIds(organizationId, projectId, [
        command.blockingTaskId,
      ]);
      if (!blocking) throw new TaskNotFoundError();
      const blockers = await this.deps.dependencies.blockersOf(organizationId, projectId, [
        task.id,
      ]);
      const created = !blockers.includes(blocking.id);
      if (created) {
        if (blockers.length >= MAX_BLOCKERS_PER_TASK) throw new DependencyLimitReachedError();
        if (
          (await this.deps.dependencies.countInProject(organizationId, projectId)) >=
          MAX_DEPENDENCIES_PER_PROJECT
        ) {
          throw new DependencyLimitReachedError();
        }
        await assertNoCycle(
          task.id,
          blocking.id,
          blockedByExpander(this.deps, organizationId, projectId),
        );
        await this.deps.dependencies.add(organizationId, projectId, task.id, blocking.id);
      }
      return {
        result: {
          task: await loadTaskView(this.deps, organizationId, project, task, context.actor.userId),
          created,
        },
        events: created
          ? [
              {
                ...eventBase(context, task),
                type: 'tasks.dependency_added' as const,
                blockingTaskId: blocking.id,
              },
            ]
          : [],
      };
    });
  }
}

/** RF-08: remove a dependência; ausente ⇒ 404 `DEPENDENCY_NOT_FOUND`. */
export class RemoveDependencyUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  execute(context: TenantRequestContext, command: DependencyCommand): Promise<void> {
    const { organizationId } = context.tenant;
    return runTaskMutation(this.deps, context, TASK_WRITE_POLICY, async () => {
      const { task } = await lockTaskForWrite(this.deps, context, command.taskId, lockOptions);
      if (task.isCanceled) throw new TaskCanceledError();
      const removed = await this.deps.dependencies.remove(
        organizationId,
        task.projectId,
        task.id,
        command.blockingTaskId,
      );
      if (!removed) throw new DependencyNotFoundError();
      return {
        result: undefined,
        events: [
          {
            ...eventBase(context, task),
            type: 'tasks.dependency_removed',
            blockingTaskId: command.blockingTaskId,
          },
        ],
      };
    });
  }
}
