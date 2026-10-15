import type { SecurityEventRecorder } from '@taskflow/backend/shared/application';

type Base = Readonly<{
  requestId: string;
  organizationId: string;
  actorUserId: string;
  projectId: string;
  taskId: string;
  commentId: string;
}>;

/**
 * Eventos de `collaboration` (log, só ids — RNF-06), registrados pela casca **depois do commit**.
 * A 008 passará a consumi-los pela Outbox (obrigações do design).
 */
export type CollaborationEvent =
  | (Base &
      Readonly<{ type: 'collaboration.comment_created'; mentionedUserIds: ReadonlyArray<string> }>)
  | (Base &
      Readonly<{
        type: 'collaboration.comment_edited';
        mentionedUserIds: ReadonlyArray<string>;
        addedMentionUserIds: ReadonlyArray<string>;
      }>)
  | (Base & Readonly<{ type: 'collaboration.comment_deleted'; moderated: boolean }>);

export type CollaborationEventRecorder = SecurityEventRecorder<CollaborationEvent>;
