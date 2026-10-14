import type { SecurityEventRecorder } from '@taskflow/backend/shared/application';

type Base = Readonly<{
  requestId: string;
  organizationId: string;
  actorUserId: string;
  projectId: string;
  taskId: string;
}>;

/**
 * Eventos de `tasks` (log, só ids), registrados pela casca **depois do commit**; o núcleo
 * (`…WithinTransaction`) só os devolve (design: núcleo e casca). A revogação por perda de acesso
 * não tem evento próprio (roda na transação de outro contexto).
 */
export type TasksEvent =
  | (Base &
      Readonly<{
        type:
          'tasks.created' | 'tasks.updated' | 'tasks.canceled' | 'tasks.reopened' | 'tasks.deleted';
      }>)
  | (Base &
      Readonly<{ type: 'tasks.assigned'; fromUserId: string | null; toUserId: string | null }>)
  | (Base & Readonly<{ type: 'tasks.status_changed'; fromStatusId: string; toStatusId: string }>)
  | (Base &
      Readonly<{
        type: 'tasks.dependency_added' | 'tasks.dependency_removed';
        blockingTaskId: string;
      }>);

export type TasksEventRecorder = SecurityEventRecorder<TasksEvent>;
