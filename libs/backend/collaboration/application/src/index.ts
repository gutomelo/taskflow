export type {
  DiscussionLock,
  DiscussionTask,
  MentionCandidate,
  MentionCandidatePage,
  TaskDiscussionAccess,
} from './lib/ports/task-discussion-access';
export type { CollaborationUserDirectory } from './lib/ports/user-directory';
export type { CollaborationDependencies } from './lib/shared/collaboration-dependencies';
export type {
  CollaborationEvent,
  CollaborationEventRecorder,
} from './lib/shared/collaboration-events';
export {
  InsufficientRoleError,
  InvalidCursorError,
  ProjectArchivedError,
  TaskCanceledError,
  TaskNotFoundError,
  TooManyReadersError,
} from './lib/shared/collaboration-errors';
export {
  CANDIDATE_QUERY_MAX_LENGTH,
  CANDIDATES_MAX_PAGE,
  COMMENT_WRITE_POLICY,
  COMMENTS_MAX_PAGE,
  MAX_COMMENTS_PER_TASK,
  MENTION_SEARCH_POLICY,
} from './lib/shared/collaboration-limits';
export type { CommentView, PersonView } from './lib/shared/comment-views';
export {
  GetCommentUseCase,
  ListCommentsUseCase,
  ListMentionCandidatesUseCase,
  type CommentPageView,
} from './lib/use-cases/comment-queries.use-cases';
export {
  CreateCommentUseCase,
  DeleteCommentUseCase,
  EditCommentUseCase,
} from './lib/use-cases/comment-writes.use-cases';
