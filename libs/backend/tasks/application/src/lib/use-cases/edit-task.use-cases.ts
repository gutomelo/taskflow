import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import { canOnProject } from '@taskflow/backend/shared/kernel';
import {
  assertNoCycle,
  parseDueDate,
  parseTaskDescription,
  ParentTaskCompletedError,
  RequiredWithoutParentError,
  TaskNotFoundError,
  TaskTitle,
  type Priority,
} from '@taskflow/backend/tasks/domain';
import { isContributor } from '../shared/contribution';
import { blockedByExpander, lockTaskForWrite } from '../shared/task-access';
import { TASK_WRITE_POLICY } from '../shared/task-limits';
import type { TaskView } from '../shared/task-views';
import {
  assertWritable,
  eventBase,
  reloadTask,
  runTaskWrite,
  type TaskWriteOutcome,
} from '../shared/task-write';
import type { TasksDependencies } from '../shared/tasks-dependencies';
import { AssigneeNotProjectMemberError } from '../shared/tasks-errors';

export type UpdateTaskCommand = Readonly<{
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  isRequired?: boolean;
  version: number;
}>;

/**
 * RF-05 (BR-008, BR-029, BR-001 com D1, D4): edita campos e a marca "obrigatória". Mexer na marca
 * trava o projeto em `tasks` (invariantes entre tarefas).
 */
export class UpdateTaskUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  execute(context: TenantRequestContext, command: UpdateTaskCommand): Promise<TaskView> {
    return runTaskWrite(this.deps, context, TASK_WRITE_POLICY, () =>
      this.updateWithinTransaction(context, command),
    );
  }

  async updateWithinTransaction(
    context: TenantRequestContext,
    command: UpdateTaskCommand,
  ): Promise<TaskWriteOutcome> {
    const { organizationId } = context.tenant;
    const title = command.title === undefined ? undefined : TaskTitle.create(command.title);
    const description =
      command.description === undefined ? undefined : parseTaskDescription(command.description);
    const dueDate = command.dueDate === undefined ? undefined : parseDueDate(command.dueDate);

    const { task, project } = await lockTaskForWrite(this.deps, context, command.taskId, {
      authorize: (role) => canOnProject(role, 'task:update', { ownsResource: false }),
      lockProject: command.isRequired !== undefined,
    });
    assertWritable(task, command.version);
    const now = this.deps.clock.now();
    if (command.isRequired === true && !task.isRequired) {
      if (task.parentTaskId === null) throw new RequiredWithoutParentError();
      const [parent] = await this.deps.tasks.findByIds(organizationId, project.projectId, [
        task.parentTaskId,
      ]);
      // A FK do pai é CASCADE: sem o pai, a subtarefa também não existiria.
      if (!parent) throw new TaskNotFoundError();
      // D1: pai concluído não pode ganhar subtarefa obrigatória pendente.
      if (parent.isCompleted && task.isPending) throw new ParentTaskCompletedError();
      // D4: a aresta implícita "pai bloqueado por esta subtarefa" não pode fechar ciclo.
      await assertNoCycle(
        parent.id,
        task.id,
        blockedByExpander(this.deps, organizationId, project.projectId),
      );
    }
    if (command.isRequired !== undefined) task.setRequired(command.isRequired, now);
    task.edit({ title, description, priority: command.priority, dueDate }, now);
    await this.deps.tasks.save(task);
    return {
      task: await reloadTask(this.deps, organizationId, task),
      projectContext: project,
      events: [{ ...eventBase(context, task), type: 'tasks.updated' }],
    };
  }
}

export type AssignTaskCommand = Readonly<{
  taskId: string;
  assigneeUserId: string | null;
  version: number;
}>;

/**
 * RF-06 (BR-003): o papel do novo responsável é relido com a membership `FOR SHARE` e o projeto
 * `FOR SHARE` — rebaixamento concorrente nunca deixa um leitor como responsável.
 */
export class AssignTaskUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  execute(context: TenantRequestContext, command: AssignTaskCommand): Promise<TaskView> {
    return runTaskWrite(this.deps, context, TASK_WRITE_POLICY, () =>
      this.assignWithinTransaction(context, command),
    );
  }

  async assignWithinTransaction(
    context: TenantRequestContext,
    command: AssignTaskCommand,
  ): Promise<TaskWriteOutcome> {
    const { organizationId } = context.tenant;
    const target = command.assigneeUserId;
    const { task, locked, project } = await lockTaskForWrite(this.deps, context, command.taskId, {
      authorize: (role) => canOnProject(role, 'task:assign', { ownsResource: false }),
      alsoLock: target === null ? [] : [target],
      lockProject: false,
    });
    assertWritable(task, command.version);
    if (target !== null && !isContributor(locked.effectiveRoles.get(target))) {
      throw new AssigneeNotProjectMemberError();
    }
    const from = task.assigneeUserId;
    if (from === target) return { task, projectContext: project, events: [] };
    task.assign(target, this.deps.clock.now());
    await this.deps.tasks.save(task);
    return {
      task: await reloadTask(this.deps, organizationId, task),
      projectContext: project,
      events: [
        { ...eventBase(context, task), type: 'tasks.assigned', fromUserId: from, toUserId: target },
      ],
    };
  }
}
