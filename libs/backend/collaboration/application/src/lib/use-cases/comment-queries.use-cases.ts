import { RateLimitedError, type TenantRequestContext } from '@taskflow/backend/shared/application';
import { CommentNotFoundError } from '@taskflow/backend/collaboration/domain';
import { canOnProject } from '@taskflow/backend/shared/kernel';
import type { DiscussionTask, MentionCandidate } from '../ports/task-discussion-access';
import type { CollaborationDependencies } from '../shared/collaboration-dependencies';
import {
  InsufficientRoleError,
  TaskNotFoundError,
  TooManyReadersError,
} from '../shared/collaboration-errors';
import {
  CANDIDATES_DEFAULT_PAGE,
  CANDIDATES_MAX_PAGE,
  COMMENTS_DEFAULT_PAGE,
  COMMENTS_MAX_PAGE,
  MENTION_SEARCH_POLICY,
} from '../shared/collaboration-limits';
import {
  decodeCandidateCursor,
  decodeCommentCursor,
  encodeCandidateCursor,
  encodeCommentCursor,
} from '../shared/comment-cursor';
import {
  canComment,
  toCommentViews,
  type CommentView,
  type ViewerOnTask,
} from '../shared/comment-views';

const clamp = (value: number | undefined, fallback: number, max: number) =>
  Math.min(Math.max(Math.trunc(value ?? fallback), 1), max);

function viewerOn(context: TenantRequestContext, task: DiscussionTask): ViewerOnTask {
  return {
    userId: context.actor.userId,
    role: task.effectiveRole,
    archived: task.archived,
    canceled: task.canceled,
  };
}

function readTask(
  deps: Pick<CollaborationDependencies, 'discussion'>,
  context: TenantRequestContext,
  taskId: string,
) {
  return deps.discussion.resolveForRead(context.tenant.organizationId, taskId, {
    userId: context.actor.userId,
    organizationRole: context.tenant.organizationRole,
  });
}

export type CommentPageView = Readonly<{
  items: ReadonlyArray<CommentView>;
  nextCursor: string | null;
  /** Não removidos; só na primeira página (sem cursor). */
  count?: number;
  actions: Readonly<{ comment: boolean }>;
}>;

/** RF-01, RF-07, RF-13: a conversa da tarefa, mais recentes primeiro, por cursor. */
export class ListCommentsUseCase {
  constructor(private readonly deps: CollaborationDependencies) {}

  async execute(
    context: TenantRequestContext,
    query: Readonly<{ taskId: string; cursor?: string | null; limit?: number }>,
  ): Promise<CommentPageView> {
    const { organizationId } = context.tenant;
    const task = await readTask(this.deps, context, query.taskId);
    if (!task) throw new TaskNotFoundError();
    const after = decodeCommentCursor(query.cursor ?? null, task.taskId);
    const limit = clamp(query.limit, COMMENTS_DEFAULT_PAGE, COMMENTS_MAX_PAGE);
    const rows = await this.deps.comments.page(organizationId, task.taskId, limit + 1, after);
    const page = rows.slice(0, limit);
    const last = page.at(-1)?.snapshot();
    const viewer = viewerOn(context, task);
    const count = after
      ? undefined
      : await this.deps.comments.countActive(organizationId, task.taskId);
    return {
      items: await toCommentViews(this.deps, organizationId, page, viewer),
      nextCursor:
        rows.length > limit && last
          ? encodeCommentCursor(task.taskId, { createdAt: last.createdAt, id: last.id })
          : null,
      ...(count === undefined ? {} : { count }),
      actions: { comment: canComment(viewer) },
    };
  }
}

/**
 * RF-14: um comentário pelo id. Inexistente, de outra organização ou de tarefa sem leitura ⇒ o
 * mesmo `COMMENT_NOT_FOUND` (M1 da segurança).
 */
export class GetCommentUseCase {
  constructor(private readonly deps: CollaborationDependencies) {}

  async execute(context: TenantRequestContext, commentId: string): Promise<CommentView> {
    const { organizationId } = context.tenant;
    const comment = await this.deps.comments.findById(organizationId, commentId);
    const task = comment ? await readTask(this.deps, context, comment.taskId) : null;
    if (!comment || !task) throw new CommentNotFoundError();
    const [view] = await toCommentViews(
      this.deps,
      organizationId,
      [comment],
      viewerOn(context, task),
    );
    if (!view) throw new CommentNotFoundError();
    return view;
  }
}

/**
 * RF-08: quem pode ser mencionado (quem lê o projeto), filtrado por nome ou e-mail, sem o próprio
 * usuário. Só para quem pode comentar (B4 da segurança); limitado por usuário e minuto.
 */
export class ListMentionCandidatesUseCase {
  constructor(private readonly deps: CollaborationDependencies) {}

  async execute(
    context: TenantRequestContext,
    query: Readonly<{ taskId: string; query: string; cursor?: string | null; limit?: number }>,
  ): Promise<Readonly<{ items: ReadonlyArray<MentionCandidate>; nextCursor: string | null }>> {
    const decision = await this.deps.rateLimiter.consume(
      MENTION_SEARCH_POLICY,
      context.actor.userId,
    );
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
    const task = await readTask(this.deps, context, query.taskId);
    if (!task) throw new TaskNotFoundError();
    if (!canOnProject(task.effectiveRole, 'comment:create', { ownsResource: false })) {
      throw new InsufficientRoleError();
    }
    const inner = decodeCandidateCursor(query.cursor ?? null, task.taskId, query.query);
    const page = await this.deps.discussion.mentionCandidates(
      context.tenant.organizationId,
      task.projectId,
      {
        query: query.query,
        excludeUserId: context.actor.userId,
        limit: clamp(query.limit, CANDIDATES_DEFAULT_PAGE, CANDIDATES_MAX_PAGE),
        cursor: inner,
      },
    );
    if (!page) throw new TooManyReadersError();
    return {
      items: page.items,
      nextCursor: page.nextCursor
        ? encodeCandidateCursor(task.taskId, query.query, page.nextCursor)
        : null,
    };
  }
}
