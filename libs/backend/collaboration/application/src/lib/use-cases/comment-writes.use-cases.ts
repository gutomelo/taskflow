import {
  ConcurrentUpdateError,
  type TenantRequestContext,
} from '@taskflow/backend/shared/application';
import {
  Comment,
  CommentDeletedError,
  CommentLimitReachedError,
  CommentNotFoundError,
  InvalidMentionError,
  parseCommentBody,
  type CommentContent,
} from '@taskflow/backend/collaboration/domain';
import {
  canOnProject,
  VersionConflictError,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import type { DiscussionLock } from '../ports/task-discussion-access';
import type { CollaborationDependencies } from '../shared/collaboration-dependencies';
import {
  InsufficientRoleError,
  ProjectArchivedError,
  TaskCanceledError,
  TaskNotFoundError,
} from '../shared/collaboration-errors';
import type { CollaborationEvent } from '../shared/collaboration-events';
import { MAX_COMMENTS_PER_TASK } from '../shared/collaboration-limits';
import { eventBase, runCommentMutation } from '../shared/comment-write';
import { toCommentViews, type CommentView } from '../shared/comment-views';

type Outcome = Readonly<{ result: CommentView; events: ReadonlyArray<CollaborationEvent> }>;

/** BR-032: toda menção nova precisa ler o projeto (relido sob lock); senão o mesmo 422. */
function assertMentionsReadable(lock: DiscussionLock, userIds: ReadonlyArray<string>): void {
  if (userIds.some((userId) => !lock.effectiveRoles.get(userId))) throw new InvalidMentionError();
}

function assertWritableState(lock: DiscussionLock): void {
  if (lock.archived) throw new ProjectArchivedError();
  if (lock.canceled) throw new TaskCanceledError();
}

async function viewOf(
  deps: CollaborationDependencies,
  context: TenantRequestContext,
  comment: Comment,
  lock: DiscussionLock,
  role: ProjectRole,
): Promise<CommentView> {
  const { organizationId } = context.tenant;
  // Relido depois de gravar: a versão é incrementada pelo repositório.
  const saved = (await deps.comments.findById(organizationId, comment.id)) ?? comment;
  const [view] = await toCommentViews(deps, organizationId, [saved], {
    userId: context.actor.userId,
    role,
    archived: lock.archived,
    canceled: lock.canceled,
  });
  if (!view) throw new CommentNotFoundError();
  return view;
}

/**
 * RF-02/RF-03 (BR-031, BR-032, BR-010). Ordem de decisão: entrada (400/422 antes do lock) → 404
 * `TASK_NOT_FOUND` → 403 → arquivado → cancelada → `INVALID_MENTION` → teto.
 */
export class CreateCommentUseCase {
  constructor(private readonly deps: CollaborationDependencies) {}

  execute(
    context: TenantRequestContext,
    command: Readonly<{ taskId: string; body: string }>,
  ): Promise<CommentView> {
    const actorUserId = context.actor.userId;
    return runCommentMutation(this.deps, context, () => {
      const content = parseCommentBody(command.body, actorUserId);
      return () => this.createWithinTransaction(context, command.taskId, content);
    });
  }

  private async createWithinTransaction(
    context: TenantRequestContext,
    taskId: string,
    content: CommentContent,
  ): Promise<Outcome> {
    const { organizationId } = context.tenant;
    const actorUserId = context.actor.userId;
    const lock = await this.deps.discussion.lockForComment(organizationId, taskId, [
      actorUserId,
      ...content.mentionedUserIds,
    ]);
    const role = lock?.effectiveRoles.get(actorUserId);
    if (!lock || !role) throw new TaskNotFoundError();
    if (!canOnProject(role, 'comment:create', { ownsResource: false }))
      throw new InsufficientRoleError();
    assertWritableState(lock);
    assertMentionsReadable(lock, content.mentionedUserIds);
    if (
      (await this.deps.comments.countActive(organizationId, lock.taskId)) >= MAX_COMMENTS_PER_TASK
    ) {
      throw new CommentLimitReachedError();
    }
    const comment = Comment.create({
      id: this.deps.idGenerator.generate(),
      organizationId,
      projectId: lock.projectId,
      taskId: lock.taskId,
      authorUserId: actorUserId,
      content,
      now: this.deps.clock.now(),
    });
    await this.deps.comments.add(comment);
    return {
      result: await viewOf(this.deps, context, comment, lock, role),
      events: [
        {
          ...eventBase(context, comment),
          type: 'collaboration.comment_created',
          mentionedUserIds: content.mentionedUserIds,
        },
      ],
    };
  }
}

/**
 * Comentário e tarefa travados na ordem única (tarefa → comentário). O único 404 é
 * `COMMENT_NOT_FOUND` (M1 da segurança): o "não encontrado" da tarefa é traduzido.
 */
async function lockCommentAndTask(
  deps: CollaborationDependencies,
  context: TenantRequestContext,
  commentId: string,
  alsoLock: (comment: Comment) => ReadonlyArray<string>,
) {
  const { organizationId } = context.tenant;
  const actorUserId = context.actor.userId;
  const found = await deps.comments.findById(organizationId, commentId);
  if (!found) throw new CommentNotFoundError();
  const extra = alsoLock(found);
  const lock = await deps.discussion.lockForComment(organizationId, found.taskId, [
    actorUserId,
    ...extra,
  ]);
  const role = lock?.effectiveRoles.get(actorUserId);
  const comment = lock && role ? await deps.comments.lockById(organizationId, commentId) : null;
  // O `taskId` de um comentário nunca muda: o travado é o mesmo da leitura.
  if (!lock || !role || !comment) throw new CommentNotFoundError();
  return { lock, role, comment, locked: new Set([actorUserId, ...extra]) };
}

/**
 * RF-04 (BR-008, BR-031, BR-032). Ordem: entrada → 404 → 403 → arquivado → cancelada →
 * `COMMENT_DELETED` → versão → menções **novas** (D10: as mantidas não são conferidas de novo).
 */
export class EditCommentUseCase {
  constructor(private readonly deps: CollaborationDependencies) {}

  execute(
    context: TenantRequestContext,
    command: Readonly<{ commentId: string; body: string; version: number }>,
  ): Promise<CommentView> {
    return runCommentMutation(this.deps, context, () => {
      const content = parseCommentBody(command.body, context.actor.userId);
      return () => this.editWithinTransaction(context, command, content);
    });
  }

  private async editWithinTransaction(
    context: TenantRequestContext,
    command: Readonly<{ commentId: string; version: number }>,
    content: CommentContent,
  ): Promise<Outcome> {
    const { lock, role, comment, locked } = await lockCommentAndTask(
      this.deps,
      context,
      command.commentId,
      (found) => found.newMentionsIn(content),
    );
    const owns = { ownsResource: comment.authorUserId === context.actor.userId };
    if (!canOnProject(role, 'comment:update', owns)) throw new InsufficientRoleError();
    assertWritableState(lock);
    if (comment.isDeleted) throw new CommentDeletedError();
    if (comment.version !== command.version) throw new VersionConflictError('Comment');
    const added = comment.newMentionsIn(content);
    // Lida sem lock antes da versão conferida: uma menção nova fora do que foi travado só aparece
    // se outra escrita mudou o comentário no meio — recuperável.
    if (added.some((userId) => !locked.has(userId))) throw new ConcurrentUpdateError();
    assertMentionsReadable(lock, added);
    const edit = comment.edit(content, this.deps.clock.now());
    if (!edit.changed)
      return { result: await viewOf(this.deps, context, comment, lock, role), events: [] };
    await this.deps.comments.save(comment);
    return {
      result: await viewOf(this.deps, context, comment, lock, role),
      events: [
        {
          ...eventBase(context, comment),
          type: 'collaboration.comment_edited',
          mentionedUserIds: content.mentionedUserIds,
          addedMentionUserIds: edit.addedMentionUserIds,
        },
      ],
    };
  }
}

/**
 * RF-05 (D4, decisão 9). Ordem: 404 → 403 → já removido (204 sem mudança) → versão. Sem checagem
 * de projeto arquivado nem tarefa cancelada: remover dado sensível não exige reabrir.
 */
export class DeleteCommentUseCase {
  constructor(private readonly deps: CollaborationDependencies) {}

  execute(
    context: TenantRequestContext,
    command: Readonly<{ commentId: string; version: number }>,
  ): Promise<void> {
    return runCommentMutation(
      this.deps,
      context,
      () => () => this.deleteWithinTransaction(context, command),
    );
  }

  private async deleteWithinTransaction(
    context: TenantRequestContext,
    command: Readonly<{ commentId: string; version: number }>,
  ): Promise<Readonly<{ result: undefined; events: ReadonlyArray<CollaborationEvent> }>> {
    const actorUserId = context.actor.userId;
    const { role, comment } = await lockCommentAndTask(
      this.deps,
      context,
      command.commentId,
      () => [],
    );
    const owns = { ownsResource: comment.authorUserId === actorUserId };
    if (!canOnProject(role, 'comment:delete', owns)) throw new InsufficientRoleError();
    if (comment.isDeleted) return { result: undefined, events: [] };
    if (comment.version !== command.version) throw new VersionConflictError('Comment');
    comment.delete(actorUserId, this.deps.clock.now());
    await this.deps.comments.save(comment);
    return {
      result: undefined,
      events: [
        {
          ...eventBase(context, comment),
          type: 'collaboration.comment_deleted',
          moderated: !owns.ownsResource,
        },
      ],
    };
  }
}
