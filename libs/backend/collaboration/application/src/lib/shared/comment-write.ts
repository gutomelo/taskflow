import { RateLimitedError, type TenantRequestContext } from '@taskflow/backend/shared/application';
import type { Comment } from '@taskflow/backend/collaboration/domain';
import type { CollaborationDependencies } from './collaboration-dependencies';
import type { CollaborationEvent } from './collaboration-events';
import { toCollaborationIntegrationEvents } from './collaboration-integration-events';
import { COMMENT_LOCK_TIMEOUT_MS, COMMENT_WRITE_POLICY } from './collaboration-limits';

/**
 * Casca de uma escrita: conta a tentativa no limite, valida a entrada **antes** de qualquer lock,
 * roda o trabalho numa transação e registra os eventos **depois do commit** (BR-010).
 */
export async function runCommentMutation<T>(
  deps: Pick<
    CollaborationDependencies,
    'rateLimiter' | 'transactions' | 'events' | 'outbox' | 'idGenerator' | 'clock'
  >,
  context: TenantRequestContext,
  prepare: () => () => Promise<Readonly<{ result: T; events: ReadonlyArray<CollaborationEvent> }>>,
): Promise<T> {
  const decision = await deps.rateLimiter.consume(COMMENT_WRITE_POLICY, context.actor.userId);
  if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
  const work = prepare();
  const { result, events } = await deps.transactions.run(
    async () => {
      const outcome = await work();
      // ADR 0017: menções novas viram evento de integração na transação do comentário.
      const integration = toCollaborationIntegrationEvents(outcome.events, deps);
      if (integration.length > 0) await deps.outbox.append(integration);
      return outcome;
    },
    { lockTimeoutMs: COMMENT_LOCK_TIMEOUT_MS },
  );
  events.forEach((event) => deps.events.record(event));
  return result;
}

export function eventBase(context: TenantRequestContext, comment: Comment) {
  const { projectId, taskId, id } = comment.snapshot();
  return {
    requestId: context.requestId,
    organizationId: context.tenant.organizationId,
    actorUserId: context.actor.userId,
    projectId,
    taskId,
    commentId: id,
  };
}
