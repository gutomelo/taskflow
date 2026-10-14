import {
  ConcurrentUpdateError,
  type TenantRequestContext,
} from '@taskflow/backend/shared/application';
import { canOnProject, projectGrant } from '@taskflow/backend/shared/kernel';
import {
  assertTransitionAllowed,
  findStatus,
  ParentTaskCompletedError,
  TaskBlockedByDependenciesError,
  TaskHasPendingRequiredSubtasksError,
  type Task,
  type WorkflowView,
} from '@taskflow/backend/tasks/domain';
import { lockTaskForWrite } from '../shared/task-access';
import { TASK_WRITE_POLICY } from '../shared/task-limits';
import { ownsTaskTree, type TaskView } from '../shared/task-views';
import {
  assertVersion,
  assertWritable,
  eventBase,
  reloadTask,
  runTaskMutation,
  runTaskWrite,
  type TaskWriteOutcome,
} from '../shared/task-write';
import type { TasksDependencies } from '../shared/tasks-dependencies';
import { StatusNotFoundError } from '../shared/tasks-errors';

const isDone = (workflow: WorkflowView, statusId: string) =>
  findStatus(workflow, statusId)?.category === 'done';

const mayUpdate = (role: Parameters<typeof canOnProject>[0]) =>
  canOnProject(role, 'task:update', { ownsResource: false });

/** BR-001: subtarefas obrigatórias pendentes da tarefa (ids para o cliente). */
async function pendingRequiredSubtasks(
  deps: Pick<TasksDependencies, 'tasks'>,
  organizationId: string,
  task: Task,
): Promise<string[]> {
  const subtasks = await deps.tasks.subtasksOf(organizationId, task.projectId, task.id);
  return subtasks.filter((subtask) => subtask.isRequired && subtask.isPending).map((s) => s.id);
}

/** D1: subtarefa obrigatória que fica pendente não pode ter o pai concluído. */
async function assertParentNotCompleted(
  deps: Pick<TasksDependencies, 'tasks'>,
  organizationId: string,
  task: Task,
): Promise<void> {
  if (!task.isRequired || task.parentTaskId === null) return;
  const [parent] = await deps.tasks.findByIds(organizationId, task.projectId, [task.parentTaskId]);
  if (parent?.isCompleted) throw new ParentTaskCompletedError();
}

export type TransitionTaskCommand = Readonly<{ taskId: string; statusId: string; version: number }>;

/**
 * RF-07 (BR-004, BR-001, BR-006 como precondição — D2 —, BR-029, BR-008). Entrar ou sair de `done`
 * trava o projeto em `tasks`. A spec 005 chama o núcleo na transação de `boards`.
 */
export class TransitionTaskUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  execute(context: TenantRequestContext, command: TransitionTaskCommand): Promise<TaskView> {
    return runTaskWrite(this.deps, context, TASK_WRITE_POLICY, () =>
      this.transitionWithinTransaction(context, command),
    );
  }

  async transitionWithinTransaction(
    context: TenantRequestContext,
    command: TransitionTaskCommand,
  ): Promise<TaskWriteOutcome> {
    const { organizationId } = context.tenant;
    const touchesDone = (workflow: WorkflowView, fromStatusId: string) =>
      isDone(workflow, fromStatusId) || isDone(workflow, command.statusId);
    const { task, project, projectLocked } = await lockTaskForWrite(
      this.deps,
      context,
      command.taskId,
      {
        authorize: mayUpdate,
        lockProject: (locked, found) => touchesDone(locked.workflow, found.statusId),
      },
    );
    assertWritable(task, command.version);
    const { workflow } = project;
    // A tarefa mudou de status entre a leitura e o lock e agora exigiria o lock do projeto.
    if (touchesDone(workflow, task.statusId) && !projectLocked) throw new ConcurrentUpdateError();
    const target = findStatus(workflow, command.statusId);
    if (!target) throw new StatusNotFoundError();
    const from = task.statusId;
    assertTransitionAllowed(workflow, from, target.id);
    const entersDone = target.category === 'done' && !isDone(workflow, from);
    const leavesDone = target.category !== 'done' && isDone(workflow, from);
    if (entersDone) {
      const pending = await pendingRequiredSubtasks(this.deps, organizationId, task);
      if (pending.length > 0) throw new TaskHasPendingRequiredSubtasksError(pending);
      const blockerIds = await this.deps.dependencies.blockersOf(organizationId, task.projectId, [
        task.id,
      ]);
      const blockers = await this.deps.tasks.findByIds(organizationId, task.projectId, blockerIds);
      const blocking = blockers.filter((blocker) => blocker.isPending).map((blocker) => blocker.id);
      if (blocking.length > 0) throw new TaskBlockedByDependenciesError(blocking);
    }
    if (leavesDone) await assertParentNotCompleted(this.deps, organizationId, task);
    task.moveTo(target, context.actor.userId, this.deps.clock.now());
    await this.deps.tasks.save(task);
    return {
      task: await reloadTask(this.deps, organizationId, task),
      projectContext: project,
      events: [
        {
          ...eventBase(context, task),
          type: 'tasks.status_changed',
          fromStatusId: from,
          toStatusId: target.id,
        },
      ],
    };
  }
}

export type TaskVersionCommand = Readonly<{ taskId: string; version: number }>;

/** RF-09 (BR-029): cancelar; cancelar de novo não muda nada. */
export class CancelTaskUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  execute(context: TenantRequestContext, command: TaskVersionCommand): Promise<TaskView> {
    return runTaskWrite(this.deps, context, TASK_WRITE_POLICY, async () => {
      const { task, project } = await lockTaskForWrite(this.deps, context, command.taskId, {
        authorize: mayUpdate,
        lockProject: true,
      });
      assertVersion(task, command.version);
      if (!task.cancel(context.actor.userId, this.deps.clock.now())) {
        return { task, projectContext: project, events: [] };
      }
      await this.deps.tasks.save(task);
      return {
        task: await reloadTask(this.deps, context.tenant.organizationId, task),
        projectContext: project,
        events: [{ ...eventBase(context, task), type: 'tasks.canceled' }],
      };
    });
  }
}

/**
 * RF-09 (BR-029, BR-001 com D1): reabrir. Volta a ser pendente se não estiver em `done` — então não
 * pode ser obrigatória de pai concluído; um pai em `done` não pode voltar com obrigatória pendente.
 */
export class ReopenTaskUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  execute(context: TenantRequestContext, command: TaskVersionCommand): Promise<TaskView> {
    return runTaskWrite(this.deps, context, TASK_WRITE_POLICY, async () => {
      const { organizationId } = context.tenant;
      const { task, project } = await lockTaskForWrite(this.deps, context, command.taskId, {
        authorize: mayUpdate,
        lockProject: true,
      });
      assertVersion(task, command.version);
      if (!task.isCanceled) return { task, projectContext: project, events: [] };
      if (task.isCompleted) {
        const pending = await pendingRequiredSubtasks(this.deps, organizationId, task);
        if (pending.length > 0) throw new TaskHasPendingRequiredSubtasksError(pending);
      } else {
        await assertParentNotCompleted(this.deps, organizationId, task);
      }
      task.reopen(this.deps.clock.now());
      await this.deps.tasks.save(task);
      return {
        task: await reloadTask(this.deps, organizationId, task),
        projectContext: project,
        events: [{ ...eventBase(context, task), type: 'tasks.reopened' }],
      };
    });
  }
}

/**
 * RF-10 (BR-008, D5): exclusão definitiva com subtarefas e dependências (cascata do banco). Member
 * só exclui quando a tarefa **e** todas as subtarefas são dele. Cancelada também pode ser excluída.
 */
export class DeleteTaskUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  execute(context: TenantRequestContext, command: TaskVersionCommand): Promise<void> {
    const { organizationId } = context.tenant;
    const actorUserId = context.actor.userId;
    return runTaskMutation(this.deps, context, TASK_WRITE_POLICY, async () => {
      const { task } = await lockTaskForWrite(this.deps, context, command.taskId, {
        // Sob o lock do projeto: ninguém cria subtarefa no meio da decisão.
        authorize: async (role, locked) => {
          const grant = projectGrant(role, 'task:delete');
          if (grant !== 'own') return grant === 'allow';
          const subtasks = await this.deps.tasks.subtasksOf(
            organizationId,
            locked.projectId,
            locked.id,
          );
          return ownsTaskTree(locked, subtasks, actorUserId);
        },
        lockProject: true,
      });
      assertVersion(task, command.version);
      await this.deps.tasks.remove(organizationId, task.projectId, task.id, command.version);
      return {
        result: undefined,
        events: [{ ...eventBase(context, task), type: 'tasks.deleted' }],
      };
    });
  }
}
