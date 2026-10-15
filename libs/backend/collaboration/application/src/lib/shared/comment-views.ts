import type { Comment } from '@taskflow/backend/collaboration/domain';
import { canOnProject, type ProjectRole } from '@taskflow/backend/shared/kernel';
import type { CollaborationDependencies } from './collaboration-dependencies';

/** `name: null` = "Ex-membro" (não é mais membro da organização — D12). */
export type PersonView = Readonly<{ userId: string; name: string | null }>;

export type CommentView = Readonly<{
  id: string;
  taskId: string;
  author: PersonView;
  /** Tokens `<@id>` canônicos; `null` = removido. */
  body: string | null;
  mentions: ReadonlyArray<PersonView>;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  version: number;
  actions: Readonly<{ edit: boolean; delete: boolean }>;
}>;

/** O que decide as ações de quem lê (papel e estado da tarefa, como a porta os devolveu). */
export type ViewerOnTask = Readonly<{
  userId: string;
  role: ProjectRole;
  archived: boolean;
  canceled: boolean;
}>;

/** Comentar: `comment:create`, fora de projeto arquivado e tarefa cancelada. */
export function canComment(viewer: ViewerOnTask): boolean {
  return (
    canOnProject(viewer.role, 'comment:create', { ownsResource: false }) &&
    !viewer.archived &&
    !viewer.canceled
  );
}

/** Ações por comentário (RF-07). Excluir vale também em só leitura (decisão 9). */
function actionsOf(comment: Comment, viewer: ViewerOnTask) {
  const owns = { ownsResource: comment.authorUserId === viewer.userId };
  const removed = comment.isDeleted;
  return {
    edit:
      !removed &&
      !viewer.archived &&
      !viewer.canceled &&
      canOnProject(viewer.role, 'comment:update', owns),
    delete: !removed && canOnProject(viewer.role, 'comment:delete', owns),
  };
}

/** Menções na ordem da primeira aparição no texto (o banco não guarda ordem). */
function inTextOrder(body: string | null, userIds: ReadonlyArray<string>): ReadonlyArray<string> {
  if (body === null) return userIds;
  const position = (userId: string) => body.indexOf(`<@${userId}>`);
  return [...userIds].sort((a, b) => position(a) - position(b));
}

/** Monta as visões com os nomes em lote (uma chamada por resposta, RNF-04). */
export async function toCommentViews(
  deps: Pick<CollaborationDependencies, 'users'>,
  organizationId: string,
  comments: ReadonlyArray<Comment>,
  viewer: ViewerOnTask,
): Promise<CommentView[]> {
  const people = [
    ...new Set(comments.flatMap((comment) => [comment.authorUserId, ...comment.mentionedUserIds])),
  ];
  const names =
    people.length === 0
      ? new Map<string, string>()
      : await deps.users.displayNames(organizationId, people);
  const person = (userId: string): PersonView => ({ userId, name: names.get(userId) ?? null });
  return comments.map((comment) => {
    const {
      id,
      taskId,
      authorUserId,
      body,
      mentionedUserIds,
      createdAt,
      editedAt,
      deletedAt,
      version,
    } = comment.snapshot();
    return {
      id,
      taskId,
      author: person(authorUserId),
      body,
      mentions: inTextOrder(body, mentionedUserIds).map(person),
      createdAt,
      editedAt,
      deletedAt,
      version,
      actions: actionsOf(comment, viewer),
    };
  });
}
