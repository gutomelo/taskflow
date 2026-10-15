import type { TaskDiscussionAccess } from '@taskflow/backend/collaboration/application';
import type { SearchUsersAmongUseCase } from '@taskflow/backend/identity/application';
import type { ListProjectReaderIdsUseCase } from '@taskflow/backend/projects/application';
import type {
  LockTaskForDiscussionUseCase,
  ResolveTaskForDiscussionUseCase,
} from '@taskflow/backend/tasks/application';

/**
 * Porta `TaskDiscussionAccess` de `collaboration` (spec 010, D8): tarefa e lock por `tasks` (que pede
 * a `projects` o projeto e os papéis), leitores por `projects` e busca por `identity` (D9). O lock
 * roda na transação de quem chama (mesma instância do runner).
 */
export function createTaskDiscussionAccess(deps: {
  readonly tasks: Readonly<{
    discussion: Readonly<{
      lockForComment: Pick<LockTaskForDiscussionUseCase, 'execute'>;
      resolveForRead: Pick<ResolveTaskForDiscussionUseCase, 'execute'>;
    }>;
  }>;
  readonly projects: Readonly<{
    contribution: Readonly<{ readerIds: Pick<ListProjectReaderIdsUseCase, 'execute'> }>;
  }>;
  readonly identity: Readonly<{ searchUsersAmong: Pick<SearchUsersAmongUseCase, 'execute'> }>;
}): TaskDiscussionAccess {
  const { discussion } = deps.tasks;
  return {
    lockForComment: (organizationId, taskId, userIds) =>
      discussion.lockForComment.execute(organizationId, taskId, userIds),
    resolveForRead: (organizationId, taskId, viewer) =>
      discussion.resolveForRead.execute(organizationId, taskId, viewer),
    async mentionCandidates(organizationId, projectId, { query, excludeUserId, limit, cursor }) {
      const readers = await deps.projects.contribution.readerIds.execute(organizationId, projectId);
      if (!readers.complete) return null;
      const page = await deps.identity.searchUsersAmong.execute(
        readers.userIds.filter((userId) => userId !== excludeUserId),
        query,
        { limit, cursor },
      );
      return {
        items: page.items.map(({ id, name, email }) => ({ userId: id, name, email })),
        nextCursor: page.nextCursor,
      };
    },
  };
}
