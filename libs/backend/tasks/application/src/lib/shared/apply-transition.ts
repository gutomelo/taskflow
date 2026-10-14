import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import {
  assertTransitionAllowed,
  findStatus,
  keyAfter,
  ParentTaskCompletedError,
  TaskBlockedByDependenciesError,
  TaskHasPendingRequiredSubtasksError,
  type Task,
  type WorkflowStatusView,
  type WorkflowView,
} from '@taskflow/backend/tasks/domain';
import type { TasksDependencies } from './tasks-dependencies';
import type { TasksEvent } from './tasks-events';
import { eventBase } from './task-write';

export const isDone = (workflow: WorkflowView, statusId: string) =>
  findStatus(workflow, statusId)?.category === 'done';

/** BR-001: subtarefas obrigatórias pendentes da tarefa (ids para o cliente). */
export async function pendingRequiredSubtasks(
  deps: Pick<TasksDependencies, 'tasks'>,
  organizationId: string,
  task: Task,
): Promise<string[]> {
  const subtasks = await deps.tasks.subtasksOf(organizationId, task.projectId, task.id);
  return subtasks
    .filter((subtask) => subtask.isRequired && subtask.isPending)
    .map((subtask) => subtask.id);
}

/** D1: subtarefa obrigatória que fica pendente não pode ter o pai concluído. */
export async function assertParentNotCompleted(
  deps: Pick<TasksDependencies, 'tasks'>,
  organizationId: string,
  task: Task,
): Promise<void> {
  if (!task.isRequired || task.parentTaskId === null) return;
  const [parent] = await deps.tasks.findByIds(organizationId, task.projectId, [task.parentTaskId]);
  if (parent?.isCompleted) throw new ParentTaskCompletedError();
}

/**
 * Núcleo da mudança de status (BR-004, BR-001, BR-006 como precondição — D2 —, D1), sobre a
 * tarefa já travada, ativa e com a versão conferida. Grava a tarefa e devolve o evento. Usado pela
 * transição do detalhe e pelo movimento de card (spec 005, S1): um único `lockTaskForWrite`.
 * Entrar ou sair de `done` exige que o chamador já segure o lock do projeto em `tasks`.
 */
export async function applyTransition(
  deps: Pick<TasksDependencies, 'tasks' | 'dependencies' | 'clock'>,
  context: TenantRequestContext,
  task: Task,
  workflow: WorkflowView,
  target: WorkflowStatusView,
): Promise<TasksEvent> {
  const { organizationId } = context.tenant;
  const from = task.statusId;
  assertTransitionAllowed(workflow, from, target.id);
  const entersDone = target.category === 'done' && !isDone(workflow, from);
  const leavesDone = target.category !== 'done' && isDone(workflow, from);
  if (entersDone) {
    const pending = await pendingRequiredSubtasks(deps, organizationId, task);
    if (pending.length > 0) throw new TaskHasPendingRequiredSubtasksError(pending);
    const blockerIds = await deps.dependencies.blockersOf(organizationId, task.projectId, [
      task.id,
    ]);
    const blockers = await deps.tasks.findByIds(organizationId, task.projectId, blockerIds);
    const blocking = blockers.filter((blocker) => blocker.isPending).map((blocker) => blocker.id);
    if (blocking.length > 0) throw new TaskBlockedByDependenciesError(blocking);
  }
  if (leavesDone) await assertParentNotCompleted(deps, organizationId, task);
  task.moveTo(target, context.actor.userId, deps.clock.now());
  await deps.tasks.save(task);
  return {
    ...eventBase(context, task),
    type: 'tasks.status_changed',
    fromStatusId: from,
    toStatusId: target.id,
  };
}

/**
 * RF-11 da spec 005: põe o card no fim da coluna do status atual (criação, transição pelo
 * detalhe, reabertura). Sem o lock do projeto: empates possíveis, desempatados por `id`.
 */
export async function appendToColumn(
  deps: Pick<TasksDependencies, 'tasks'>,
  organizationId: string,
  task: Task,
): Promise<void> {
  const last = await deps.tasks.lastRankInColumn(
    organizationId,
    task.projectId,
    task.statusId,
    task.id,
  );
  await deps.tasks.placeCard(organizationId, task.projectId, task.id, keyAfter(last));
}
