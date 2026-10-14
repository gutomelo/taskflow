import type { ProjectRole } from '@taskflow/backend/shared/kernel';
import {
  findStatus,
  formatTaskKey,
  taskActions,
  type Priority,
  type StatusCategory,
  type Task,
  type TaskActions,
  type WorkflowView,
} from '@taskflow/backend/tasks/domain';
import { MAX_BLOCKING_IN_DETAIL } from './task-limits';
import type { TasksDependencies } from './tasks-dependencies';

/** Projeto de uma tarefa com o papel efetivo de quem pede. */
export type TaskProjectContext = Readonly<{
  projectId: string;
  key: string;
  archived: boolean;
  workflow: WorkflowView;
  effectiveRole: ProjectRole;
}>;

export type TaskSummaryView = Readonly<{
  id: string;
  key: string;
  number: number;
  projectId: string;
  title: string;
  status: Readonly<{ id: string; name: string; category: StatusCategory }>;
  priority: Priority;
  assignee: Readonly<{ userId: string; name: string | null }> | null;
  dueDate: string | null;
  parentTaskId: string | null;
  isRequired: boolean;
  completedAt: Date | null;
  canceledAt: Date | null;
  version: number;
}>;

export type TaskView = TaskSummaryView &
  Readonly<{
    description: string | null;
    createdByUserId: string;
    createdAt: Date;
    actions: TaskActions;
    subtasks: ReadonlyArray<TaskSummaryView>;
    blockedBy: ReadonlyArray<TaskSummaryView>;
    blocking: ReadonlyArray<TaskSummaryView>;
    blockingTruncated: boolean;
  }>;

export function toTaskSummaryView(
  task: Task,
  project: Readonly<{ key: string; workflow: WorkflowView }>,
  names: ReadonlyMap<string, string>,
): TaskSummaryView {
  const snapshot = task.toSnapshot();
  const status = findStatus(project.workflow, snapshot.statusId);
  // A FK composta garante o status no workflow do projeto; ausência é dado corrompido.
  if (!status) throw new Error(`Task ${snapshot.id} has a status outside the project workflow`);
  return {
    id: snapshot.id,
    key: formatTaskKey(project.key, snapshot.number),
    number: snapshot.number,
    projectId: snapshot.projectId,
    title: snapshot.title.value,
    status: { id: status.id, name: status.name, category: status.category },
    priority: snapshot.priority,
    assignee: snapshot.assigneeUserId
      ? { userId: snapshot.assigneeUserId, name: names.get(snapshot.assigneeUserId) ?? null }
      : null,
    dueDate: snapshot.dueDate,
    parentTaskId: snapshot.parentTaskId,
    isRequired: snapshot.isRequired,
    completedAt: snapshot.completedAt,
    canceledAt: snapshot.canceledAt,
    version: snapshot.version,
  };
}

/** Responsáveis distintos, para uma única consulta de nomes. */
export function assigneesOf(tasks: ReadonlyArray<Task>): string[] {
  return [
    ...new Set(
      tasks.flatMap((task) => (task.assigneeUserId === null ? [] : [task.assigneeUserId])),
    ),
  ];
}

/**
 * RF-04: detalhe com subtarefas, bloqueadoras, bloqueadas (até 50) e ações do leitor, em número
 * fixo de consultas.
 */
export async function loadTaskView(
  deps: Pick<TasksDependencies, 'tasks' | 'dependencies' | 'users'>,
  organizationId: string,
  project: TaskProjectContext,
  task: Task,
  viewerUserId: string,
): Promise<TaskView> {
  const { projectId } = project;
  const [subtasks, blockerIds, blockedIds] = await Promise.all([
    deps.tasks.subtasksOf(organizationId, projectId, task.id),
    deps.dependencies.blockersOf(organizationId, projectId, [task.id]),
    deps.dependencies.blockedBy(organizationId, projectId, task.id, MAX_BLOCKING_IN_DETAIL + 1),
  ]);
  const linked = await deps.tasks.findByIds(organizationId, projectId, [
    ...blockerIds,
    ...blockedIds.slice(0, MAX_BLOCKING_IN_DETAIL),
  ]);
  const blockers = new Set(blockerIds);
  const names = await deps.users.getNames(assigneesOf([task, ...subtasks, ...linked]));
  const summary = (item: Task) => toTaskSummaryView(item, project, names);
  const snapshot = task.toSnapshot();
  return {
    ...summary(task),
    description: snapshot.description,
    createdByUserId: snapshot.createdByUserId,
    createdAt: snapshot.createdAt,
    actions: taskActions({
      effectiveRole: project.effectiveRole,
      archived: project.archived,
      task: { isCanceled: task.isCanceled, statusId: task.statusId },
      ownsTaskTree: ownsTaskTree(task, subtasks, viewerUserId),
      workflow: project.workflow,
    }),
    subtasks: subtasks.map(summary),
    blockedBy: linked.filter((item) => blockers.has(item.id)).map(summary),
    blocking: linked.filter((item) => !blockers.has(item.id)).map(summary),
    blockingTruncated: blockedIds.length > MAX_BLOCKING_IN_DETAIL,
  };
}

/** D5: a tarefa e todas as subtarefas foram criadas por `userId` (a cascata não apaga trabalho alheio). */
export function ownsTaskTree(task: Task, subtasks: ReadonlyArray<Task>, userId: string): boolean {
  return (
    task.createdByUserId === userId &&
    subtasks.every((subtask) => subtask.createdByUserId === userId)
  );
}
