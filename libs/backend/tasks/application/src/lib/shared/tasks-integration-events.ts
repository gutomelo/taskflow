import {
  createIntegrationEvent,
  type IntegrationEvent,
  type IntegrationEventFactoryDependencies,
} from '@taskflow/backend/shared/application';
import type { TasksEvent } from './tasks-events';

/**
 * Eventos de integração de `tasks` (ADR 0017): só ids, gravados na Outbox na transação do fato.
 * O consumidor (worker) valida com um schema que `satisfies` estes tipos.
 */
export const TasksIntegrationEventType = {
  assigneeChanged: 'tasks.assignee_changed',
} as const;

/** O responsável passou a ser alguém (criação ou atribuição). O produtor emite o fato (D7). */
export type AssigneeChangedPayload = Readonly<{
  organizationId: string;
  projectId: string;
  taskId: string;
  actorUserId: string;
  assigneeUserId: string;
}>;

/** Tradução pura dos eventos internos do núcleo para os de integração. */
export function toTasksIntegrationEvents(
  events: ReadonlyArray<TasksEvent>,
  deps: IntegrationEventFactoryDependencies,
): IntegrationEvent[] {
  return events.flatMap((event) => {
    if (event.type !== 'tasks.assigned' || event.toUserId === null) return [];
    const payload: AssigneeChangedPayload = {
      organizationId: event.organizationId,
      projectId: event.projectId,
      taskId: event.taskId,
      actorUserId: event.actorUserId,
      assigneeUserId: event.toUserId,
    };
    return [createIntegrationEvent(TasksIntegrationEventType.assigneeChanged, payload, deps)];
  });
}
