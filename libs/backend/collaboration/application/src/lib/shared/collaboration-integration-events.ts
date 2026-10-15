import {
  createIntegrationEvent,
  type IntegrationEvent,
  type IntegrationEventFactoryDependencies,
} from '@taskflow/backend/shared/application';
import type { CollaborationEvent } from './collaboration-events';

/**
 * Eventos de integração de `collaboration` (ADR 0017; obrigação 1 da spec 010 com um evento
 * dedicado): só ids, gravados na Outbox na transação do comentário.
 */
export const CollaborationIntegrationEventType = {
  mentionsAdded: 'collaboration.mentions_added',
} as const;

/** Menções **novas** de um comentário criado ou editado (BR-032). */
export type MentionsAddedPayload = Readonly<{
  organizationId: string;
  projectId: string;
  taskId: string;
  commentId: string;
  actorUserId: string;
  userIds: ReadonlyArray<string>;
}>;

/** Tradução pura dos eventos internos para os de integração. */
export function toCollaborationIntegrationEvents(
  events: ReadonlyArray<CollaborationEvent>,
  deps: IntegrationEventFactoryDependencies,
): IntegrationEvent[] {
  return events.flatMap((event) => {
    const userIds =
      event.type === 'collaboration.comment_created'
        ? event.mentionedUserIds
        : event.type === 'collaboration.comment_edited'
          ? event.addedMentionUserIds
          : [];
    if (userIds.length === 0) return [];
    const payload: MentionsAddedPayload = {
      organizationId: event.organizationId,
      projectId: event.projectId,
      taskId: event.taskId,
      commentId: event.commentId,
      actorUserId: event.actorUserId,
      userIds,
    };
    return [createIntegrationEvent(CollaborationIntegrationEventType.mentionsAdded, payload, deps)];
  });
}
