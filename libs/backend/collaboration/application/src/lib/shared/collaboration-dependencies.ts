import type { RateLimiter, TransactionRunner } from '@taskflow/backend/shared/application';
import type { CommentRepository } from '@taskflow/backend/collaboration/domain';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import type { TaskDiscussionAccess } from '../ports/task-discussion-access';
import type { CollaborationUserDirectory } from '../ports/user-directory';
import type { CollaborationEventRecorder } from './collaboration-events';

/** Dependências dos casos de uso de `collaboration`, montadas uma vez no composition root. */
export interface CollaborationDependencies {
  readonly discussion: TaskDiscussionAccess;
  readonly comments: CommentRepository;
  readonly users: CollaborationUserDirectory;
  readonly transactions: TransactionRunner;
  readonly rateLimiter: RateLimiter;
  readonly events: CollaborationEventRecorder;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}
