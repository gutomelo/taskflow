import {
  RateLimitedError,
  type RateLimitPolicy,
  type TenantRequestContext,
} from '@taskflow/backend/shared/application';
import { VersionConflictError } from '@taskflow/backend/shared/kernel';
import { TaskCanceledError, TaskNotFoundError, type Task } from '@taskflow/backend/tasks/domain';
import { loadTaskView, type TaskProjectContext, type TaskView } from './task-views';
import type { TasksDependencies } from './tasks-dependencies';
import type { TasksEvent } from './tasks-events';

/** Resultado de um núcleo de escrita: a tarefa gravada e os eventos para depois do commit. */
export type TaskWriteOutcome = Readonly<{
  task: Task;
  projectContext: TaskProjectContext;
  events: ReadonlyArray<TasksEvent>;
}>;

/**
 * Casca HTTP de uma escrita (design: núcleo e casca): conta a tentativa no limite, roda o trabalho
 * numa transação e registra os eventos **depois do commit**.
 */
export async function runTaskMutation<T>(
  deps: Pick<TasksDependencies, 'rateLimiter' | 'transactions' | 'events'>,
  context: TenantRequestContext,
  policy: RateLimitPolicy,
  work: () => Promise<Readonly<{ result: T; events: ReadonlyArray<TasksEvent> }>>,
): Promise<T> {
  const decision = await deps.rateLimiter.consume(policy, context.actor.userId);
  if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
  const { result, events } = await deps.transactions.run(work);
  events.forEach((event) => deps.events.record(event));
  return result;
}

/** Casca de uma escrita que responde com o detalhe, montado na mesma transação. */
export function runTaskWrite(
  deps: TasksDependencies,
  context: TenantRequestContext,
  policy: RateLimitPolicy,
  core: () => Promise<TaskWriteOutcome>,
): Promise<TaskView> {
  return runTaskMutation(deps, context, policy, async () => {
    const outcome = await core();
    return {
      events: outcome.events,
      result: await loadTaskView(
        deps,
        context.tenant.organizationId,
        outcome.projectContext,
        outcome.task,
        context.actor.userId,
      ),
    };
  });
}

/** Relê depois de gravar (a versão é incrementada pelo repositório). */
export async function reloadTask(
  deps: Pick<TasksDependencies, 'tasks'>,
  organizationId: string,
  task: Task,
): Promise<Task> {
  const [saved] = await deps.tasks.findByIds(organizationId, task.projectId, [task.id]);
  if (!saved) throw new TaskNotFoundError();
  return saved;
}

/** Tarefa relida sob lock: cancelada (409) antes da versão (409), como na ordem de decisão. */
export function assertWritable(task: Task, version: number): void {
  if (task.isCanceled) throw new TaskCanceledError();
  assertVersion(task, version);
}

export function assertVersion(task: Task, version: number): void {
  if (task.version !== version) throw new VersionConflictError('Task');
}

export function eventBase(context: TenantRequestContext, task: Task) {
  return {
    requestId: context.requestId,
    organizationId: context.tenant.organizationId,
    actorUserId: context.actor.userId,
    projectId: task.projectId,
    taskId: task.id,
  };
}
