import { Task, TaskTitle, isPriority, type Priority } from '@taskflow/backend/tasks/domain';
import type { TaskRow } from '@taskflow/backend/shared/infrastructure';

function priorityFrom(value: string): Priority {
  if (!isPriority(value)) throw new Error(`Unknown task priority in database: ${value}`);
  return value;
}

/** `DATE` do banco ⇄ `YYYY-MM-DD` (sem hora nem fuso). */
export const dueDateFrom = (value: Date | null) =>
  value ? value.toISOString().slice(0, 10) : null;
export const dueDateTo = (value: string | null) =>
  value ? new Date(`${value}T00:00:00.000Z`) : null;

export function toTask(row: TaskRow): Task {
  return Task.restore({
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    number: row.number,
    title: TaskTitle.create(row.title),
    description: row.description,
    statusId: row.statusId,
    priority: priorityFrom(row.priority),
    assigneeUserId: row.assigneeUserId,
    dueDate: dueDateFrom(row.dueDate),
    parentTaskId: row.parentTaskId,
    isRequired: row.isRequired,
    completedAt: row.completedAt,
    completedByUserId: row.completedByUserId,
    canceledAt: row.canceledAt,
    canceledByUserId: row.canceledByUserId,
    createdByUserId: row.createdByUserId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** Colunas graváveis (sem `id`, `organizationId`, `projectId`, `number`, `createdAt`). */
export function writableColumns(task: Task) {
  const snapshot = task.toSnapshot();
  return {
    title: snapshot.title.value,
    description: snapshot.description,
    statusId: snapshot.statusId,
    priority: snapshot.priority,
    assigneeUserId: snapshot.assigneeUserId,
    dueDate: dueDateTo(snapshot.dueDate),
    isRequired: snapshot.isRequired,
    completedAt: snapshot.completedAt,
    completedByUserId: snapshot.completedByUserId,
    canceledAt: snapshot.canceledAt,
    canceledByUserId: snapshot.canceledByUserId,
    updatedAt: snapshot.updatedAt,
  };
}
