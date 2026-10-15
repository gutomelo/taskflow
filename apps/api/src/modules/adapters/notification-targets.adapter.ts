import type { ListActiveMentionsUseCase } from '@taskflow/backend/collaboration/application';
import type { NotificationTargets } from '@taskflow/backend/notifications/application';
import type { ResolveVisibleTasksUseCase } from '@taskflow/backend/tasks/application';

/**
 * Porta `NotificationTargets` de `notifications` (spec 008, D9): tarefas visíveis por `tasks` (que
 * consulta `projects`) e menções ativas por `collaboration`, em lote. Só leitura; erro propaga
 * (falha fechado). Mesmo adaptador na API e no worker.
 */
export function createNotificationTargets(deps: {
  readonly tasks: Readonly<{
    notifications: Readonly<{ visibleTasks: Pick<ResolveVisibleTasksUseCase, 'execute'> }>;
  }>;
  readonly collaboration: Readonly<{
    notifications: Readonly<{ activeMentions: Pick<ListActiveMentionsUseCase, 'execute'> }>;
  }>;
}): NotificationTargets {
  return {
    visibleTasks: (organizationId, viewer, taskIds) =>
      deps.tasks.notifications.visibleTasks.execute(organizationId, viewer, taskIds),
    activeMentions: (organizationId, mentions) =>
      deps.collaboration.notifications.activeMentions.execute(organizationId, mentions),
  };
}
